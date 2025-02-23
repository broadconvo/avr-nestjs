import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createOpenAI } from '@ai-sdk/openai';
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
  private openai: any;
  private speechClient: SpeechClient;

  onModuleInit() {
    this.speechClient = new SpeechClient();
    this.openai = createOpenAI({
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
        console.error('connection error:', err);
      });

      // Assuming SLIN16 at 8000 Hz based on STT config (correct comment if different)
      await res.play(greetingsAudioPath);

      this.streamToGoogleSTT(audioStream, res);
    });

    audioSocket.listen(this.port, () => {
      this.logger.log(`server listening on port ${this.port}`);
    });
  }

  private streamToGoogleSTT(audioStream: PassThrough, res: AudioStream) {
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
    audioStream.pipe(writeStream); // Keep this for the full conversation

    // VAD configuration
    const debounceTime = 500; // 1.5 seconds of silence to detect speech end
    const vadStream = VAD.createStream({
      audioFrequency: 8000, // Matches STT config
      mode: VAD.Mode.NORMAL,
      debounceTime: debounceTime,
    });

    let isSpeaking = false;
    let currentSegmentStream: PassThrough | null = null;
    let audioBuffer: Buffer[] = []; // Buffer to store audio during speech

    audioStream.pipe(vadStream);

    // Add this to ensure vadStream ends when audioStream finishes
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
            audioBuffer = []; // Reset buffer for new speech segment
            audioStream.pipe(currentSegmentStream);
            // Buffer audio data during speech
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
              currentSegmentStream.end(); // End the segment stream

              // Combine buffered audio and send to Google STT
              const audioSegment = Buffer.concat(audioBuffer);

              // Configure Google STT
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
                  interimResults: false, // No need for interim results since we send after speech ends
                };

              this.logger.log('Sending to Google Speech API...');
              const speechToTextStream = this.speechClient
                .streamingRecognize(streamingConfig)
                .on('data', (data) => {
                  if (data.results?.[0]?.isFinal) {
                    const transcription =
                      data.results[0].alternatives[0].transcript;
                    this.logger.log(`Full Transcription: ${transcription}`);
                    // TODO: Process transcription (e.g., send to OpenAI)
                  }
                })
                .on('end', () => {
                  this.logger.log('Google Speech stream ended for segment');
                })
                .on('error', (err) => {
                  this.logger.error(`Google Speech Error: ${err.message}`);
                });

              // Write buffered audio to STT stream and end it
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
}
