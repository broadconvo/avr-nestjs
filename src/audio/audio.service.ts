import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import OpenAI from 'openai'; // Import the official OpenAI library
import { PassThrough } from 'stream';
import { protos, SpeechClient } from '@google-cloud/speech';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AudioSocket, AudioStream } from '@fonoster/streams';
import * as VAD from 'node-vad';

@Injectable()
export class AudioSocketService implements OnModuleInit {
  private readonly logger = new Logger(AudioSocketService.name);
  private readonly port = 9093; // TCP Port
  private openaiAssistant: OpenAI; // For Assistants API
  private speechClient: SpeechClient;
  private assistantId = 'asst_yGxTmokn0m8LMmL5el0Z8DXh'; // Your Assistant ID

  onModuleInit() {
    this.speechClient = new SpeechClient();
    this.openaiAssistant = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.startServer();
  }

  private startServer() {
    const greetingsAudioPath = path.join(
      __dirname,
      '..',
      '..',
      'assets',
      'audio',
      'greetings.wav',
    );

    const audioSocket = new AudioSocket();

    audioSocket.onConnection(async (req, res) => {
      this.logger.log('new connection from:', req.ref);

      const audioStream = new PassThrough();

      res.onData((data) => {
        audioStream.write(data);
      });

      res.onClose(() => {
        audioStream.end();
        this.logger.log('connection closed');
      });

      res.onError((err) => {
        audioStream.end();
        this.logger.error('connection error:', err);
      });

      // Assuming SLIN16 at 8000 Hz based on STT config
      await res.play(greetingsAudioPath);

      await this.streamToGoogleSTT(audioStream, res);
    });

    audioSocket.listen(this.port, () => {
      this.logger.log(`server listening on port ${this.port}`);
    });
  }

  private async streamToGoogleSTT(audioStream: PassThrough, res: AudioStream) {
    this.logger.log('Starting Google STT Streaming...');

    // Save raw audio for debugging (optional)
    const filePath = path.join(
      __dirname,
      '..',
      'assets',
      'audio',
      'debug_audio.raw',
    );
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const writeStream = fs.createWriteStream(filePath);
    audioStream.pipe(writeStream);

    // VAD configuration
    const debounceTime = 500; // 0.5 seconds of silence to detect speech end
    const vadStream = VAD.createStream({
      audioFrequency: 8000,
      mode: VAD.Mode.NORMAL,
      debounceTime: debounceTime,
    });

    let isSpeaking = false;
    let currentSegmentStream: PassThrough | null = null;
    let audioBuffer: Buffer[] = [];

    audioStream.pipe(vadStream);

    audioStream.on('finish', () => {
      vadStream.end();
    });

    vadStream
      .on('data', (data: VAD.Result) => {
        if (data.speech.start) {
          if (!isSpeaking) {
            isSpeaking = true;
            this.logger.log('Speech started');
            currentSegmentStream = new PassThrough();
            audioBuffer = [];
            audioStream.pipe(currentSegmentStream);
            currentSegmentStream.on('data', (chunk) => {
              audioBuffer.push(chunk);
            });
          }
        }

        if (data.speech.end) {
          if (isSpeaking) {
            isSpeaking = false;
            this.logger.log(`Speech ended after ${debounceTime / 1000}s`);

            if (currentSegmentStream) {
              audioStream.unpipe(currentSegmentStream);
              currentSegmentStream.end();

              const audioSegment = Buffer.concat(audioBuffer);

              const streamingConfig: protos.google.cloud.speech.v1.IStreamingRecognitionConfig =
                {
                  config: {
                    encoding:
                      protos.google.cloud.speech.v1.RecognitionConfig
                        .AudioEncoding.LINEAR16,
                    sampleRateHertz: 8000,
                    languageCode: 'en-US',
                    enableAutomaticPunctuation: true,
                  },
                  interimResults: false,
                };

              this.logger.log('Sending to Google Speech API...');
              const speechToTextStream = this.speechClient
                .streamingRecognize(streamingConfig)
                .on('data', async (data) => {
                  if (data.results?.[0]?.isFinal) {
                    const transcription =
                      data.results[0].alternatives[0].transcript;
                    this.logger.log(`Full Transcription: ${transcription}`);

                    if (transcription !== '') {
                      // Send transcription to OpenAI Assistant
                      const assistantResponse =
                        await this.sendToAssistant(transcription);
                      this.logger.log(
                        `Assistant Response: ${assistantResponse}`,
                      );
                      // TODO: Send to Synthesizer
                    } else {
                      this.logger.log('Empty transcription');
                    }
                  }
                })
                .on('end', () => {
                  this.logger.log('Google Speech stream ended for segment');
                })
                .on('error', (err) => {
                  this.logger.error(`Google Speech Error: ${err.message}`);
                });

              speechToTextStream.write(audioSegment);
              speechToTextStream.end();

              currentSegmentStream = null;
              audioBuffer = [];
            }
          }
        }
      })
      .on('end', () => {
        writeStream.end();
        this.logger.log('Audio stream ended');
      })
      .on('error', (err) => {
        writeStream.end();
        this.logger.error('Error processing audio stream:', err);
      });
  }

  private async sendToAssistant(transcription: string): Promise<string> {
    try {
      this.logger.log(`Sending to OpenAI Assistant: ${transcription}`);
      // Create a new thread
      const thread = await this.openaiAssistant.beta.threads.create();

      // Add the user's message to the thread
      await this.openaiAssistant.beta.threads.messages.create(thread.id, {
        role: 'user',
        content: transcription,
      });

      // Run the Assistant on the thread
      const run = await this.openaiAssistant.beta.threads.runs.create(
        thread.id,
        {
          assistant_id: this.assistantId,
        },
      );

      // Poll for the run to complete
      let runStatus = await this.openaiAssistant.beta.threads.runs.retrieve(
        thread.id,
        run.id,
      );
      while (runStatus.status !== 'completed') {
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second
        runStatus = await this.openaiAssistant.beta.threads.runs.retrieve(
          thread.id,
          run.id,
        );
      }

      // Retrieve the Assistant's response
      const messages = await this.openaiAssistant.beta.threads.messages.list(
        thread.id,
      );
      const assistantMessage = messages.data.find(
        (msg) => msg.role === 'assistant',
      );

      return assistantMessage?.content?.[0]?.type === 'text'
        ? assistantMessage.content[0].text.value
        : 'No text response';
    } catch (error) {
      this.logger.error(`Error sending to OpenAI Assistant: ${error.message}`);
      return 'Error processing request';
    }
  }
}
