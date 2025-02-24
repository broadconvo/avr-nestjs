import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import OpenAI from 'openai'; // Import the official OpenAI library
import { PassThrough } from 'stream';
import { protos as speechProtos, SpeechClient } from '@google-cloud/speech';
import {
  protos as textProtos,
  TextToSpeechClient,
} from '@google-cloud/text-to-speech';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AudioSocket, AudioStream } from '@fonoster/streams';
import * as VAD from 'node-vad';
import axios from 'axios';

@Injectable()
export class AudioSocketService implements OnModuleInit {
  private readonly logger = new Logger(AudioSocketService.name);
  private readonly port = 9093; // TCP Port
  private openaiAssistant: OpenAI; // For Assistants API
  private speechClient: SpeechClient;
  private assistantId = 'asst_yGxTmokn0m8LMmL5el0Z8DXh'; // Your Assistant ID
  private textToSpeechClient: TextToSpeechClient;
  private res: AudioStream;

  onModuleInit() {
    this.speechClient = new SpeechClient();
    this.textToSpeechClient = new TextToSpeechClient();
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

      this.res = res;
      this.streamToGoogleSTT(audioStream);
    });

    audioSocket.listen(this.port, () => {
      this.logger.log(`server listening on port ${this.port}`);
    });
  }

  private streamToGoogleSTT(audioStream: PassThrough) {
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
    const debounceTime = 300; // 0.5 seconds of silence to detect speech end
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

            if (currentSegmentStream) {
              audioStream.unpipe(currentSegmentStream);
              currentSegmentStream.end();

              const audioSegment = Buffer.concat(audioBuffer);

              const streamingConfig: speechProtos.google.cloud.speech.v1.IStreamingRecognitionConfig =
                {
                  config: {
                    encoding:
                      speechProtos.google.cloud.speech.v1.RecognitionConfig
                        .AudioEncoding.LINEAR16,
                    sampleRateHertz: 8000,
                    languageCode: 'en-US',
                  },
                  interimResults: false,
                };

              let transcription = '';
              const speechToTextStream = this.speechClient
                .streamingRecognize(streamingConfig)
                .on('data', async (data) => {
                  if (data.results?.[0]?.isFinal) {
                    transcription = data.results[0].alternatives[0].transcript;
                    this.logger.log(`Full Transcription: ${transcription}`);

                    if (transcription !== '') {
                      // Send transcription to OpenAI Assistant
                      const assistantResponse =
                        await this.sendToAssistant(transcription);
                      this.logger.log(
                        `Assistant Response: ${assistantResponse}`,
                      );

                      // Add TTS conversion and playback
                      await this.synthesizeAndPlay(assistantResponse);
                    } else {
                      this.logger.log('Empty transcription');
                    }
                  }
                })
                .on('end', () => {
                  if (transcription !== '') {
                    this.logger.log('Google Speech stream ended for segment');
                  }
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
      let response: string = '';
      await axios
        .post('https://dev.roborachel.com/voice/v2/query', {
          message: transcription,
          language: 'English',
          uniqueId: '1734315099.149537', // from pbx - search CDR
          rachelId: '86034909', // under rachel_tenant
        })
        .then((res) => {
          console.log(res.data);
          response = res.data.response;
        });

      return response;
    } catch (error) {
      this.logger.error(`Error sending to OpenAI Assistant: ${error.message}`);
      return 'I am sorry, I am not able to process your request at the moment.';
    }
  }

  private async synthesizeAndPlay(text: string) {
    this.logger.log(`Synthesizing speech: ${text}`);

    // Ensure this.res is available
    if (!this.res) {
      this.logger.error('AudioStream (this.res) is not initialized');
      return;
    }

    // Configure the TTS request for SLIN16 at 8 kHz
    const request = {
      input: { text },
      voice: { languageCode: 'en-US', ssmlGender: 'FEMALE' as const },
      audioConfig: {
        audioEncoding:
          textProtos.google.cloud.texttospeech.v1.AudioEncoding.LINEAR16,
        sampleRateHertz: 8000,
      },
    };

    try {
      // Synthesize speech
      const [response] =
        await this.textToSpeechClient.synthesizeSpeech(request);
      const audioBuffer = response.audioContent as Buffer;

      this.logger.log(
        `Synthesized audio buffer length: ${audioBuffer.length} bytes`,
      );

      // Asterisk expects 20ms frames for SLIN16 at 8 kHz
      // 8 kHz * 2 bytes/sample * 0.02s = 320 bytes per frame
      const frameSize = 320;
      let offset = 0;

      // Simulate streaming by sending frames
      const sendFrame = () => {
        if (offset >= audioBuffer.length || !this.res) {
          this.logger.log('Finished streaming synthesized audio');
          return;
        }

        const frame = audioBuffer.slice(offset, offset + frameSize);
        offset += frameSize;

        this.res.write(frame);

        // Send the next frame after 20ms to simulate real-time playback
        setTimeout(sendFrame, 20);
      };

      // Start sending frames
      sendFrame();
    } catch (error) {
      this.logger.error(
        `Error synthesizing or streaming speech: ${error.message}`,
      );
    }
  }
}
