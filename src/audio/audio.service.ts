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
  private streamingConfig: speechProtos.google.cloud.speech.v1.IStreamingRecognitionConfig =
    {
      config: {
        encoding:
          speechProtos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding
            .LINEAR16,
        sampleRateHertz: 8000,
        languageCode: 'en-US',
        model: 'phone_call', // Optimized for phone call audio
        useEnhanced: true, // Enables enhanced model for better noise robustness
      },
      interimResults: false, // Set to true if you want interim results
    };

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
      setTimeout(async () => await res.play(greetingsAudioPath), 500);

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
    const vadStream = VAD.createStream({
      audioFrequency: 8000,
      mode: VAD.Mode.VERY_AGGRESSIVE, // More selective, reduces false positives from noise
      debounceTime: 200, // Reduced for faster response, adjust based on testing
    });

    audioStream.pipe(vadStream);

    let isSpeaking = false;
    let sttStream: any = null;
    let transcription = '';

    vadStream.on('data', (data: VAD.Result) => {
      if (data.speech.start && !isSpeaking) {
        isSpeaking = true;
        transcription = '';

        sttStream = this.speechClient
          .streamingRecognize(this.streamingConfig)
          .on('data', (response) => {
            console.log(response);
            if (response.results?.[0]?.isFinal) {
              transcription = response.results[0].alternatives[0].transcript;
              this.logger.log(`Final Transcription: ${transcription}`);
              this.processTranscription(transcription);
            }
          })
          .on('error', (err) => {
            this.logger.error(`STT Error: ${err.message}`);
          })
          .on('end', () => {
            this.logger.log('Speech-To-Text stream ended');
          });

        // Write the first audio chunk
        this.logger.log('Writing audio chunk to stream for STT');
        sttStream.write(data.audioData);
      } else if (isSpeaking && data.speech.state) {
        this.logger.log('Still Speaking');
        // Continue writing audio chunks during speech
        sttStream.write(data.audioData);
      } else if (data.speech.end && isSpeaking) {
        this.logger.log('End Speaking');
        isSpeaking = false;
        sttStream.end();
      }
    });

    vadStream.on('end', () => {
      sttStream.end();
      writeStream.end();
      this.logger.log('VAD stream ended');
    });

    vadStream.on('error', (err) => {
      writeStream.end();
      this.logger.error('VAD error:', err);
    });

    audioStream.on('finish', () => {
      vadStream.end();
      this.logger.log('Audio stream ended');
    });
  }

  private async processTranscription(transcription: string) {
    if (transcription.trim() !== '') {
      const assistantResponse = await this.sendToAssistant(transcription);
      this.logger.log(`Assistant Response: ${assistantResponse}`);
      await this.synthesizeAndPlay(assistantResponse);
    } else {
      this.logger.log('Empty transcription');
    }
  }

  private async sendToAssistant(transcription: string): Promise<string> {
    try {
      this.logger.log(`Sending to OpenAI Assistant: ${transcription}`);
      // Create a new thread
      let response: string = '';
      await axios
        .post('https://dev.roborachel.com/voice/query', {
          message: transcription,
          language: 'English',
          uniqueId: '1734315099.149537', // from pbx - search CDR
          rachelId: 'aaae606e-0585-40c2-afbc-ff501437c1cf', // under rachel_tenant
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
