import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
import { ConfigService } from '@nestjs/config';
import { CallSession } from './call-session';

@Injectable()
export class AudioSocketService implements OnModuleInit {
  private activeCalls: Map<string, CallSession> = new Map();
  private readonly sampleRateHertz = 8000;
  private readonly logger = new Logger(AudioSocketService.name);
  private readonly port: number; // TCP Port
  private language: string;
  private speechClient: SpeechClient;
  private textToSpeechClient: TextToSpeechClient;
  private readonly backchannelAudio = this.getAudioAsset('backchannel.wav');
  private readonly greetingsAudio: string;
  private speechToTextConfig: speechProtos.google.cloud.speech.v1.IStreamingRecognitionConfig;
  private readonly textToSpeechConfig;

  constructor(private readonly configService: ConfigService) {
    const languageSpeechText = this.configService.get<string>(
      'LANGUAGE_SPEECH_TO_TEXT',
      'en-us',
    );
    const languageTextSpeech = this.configService.get<string>(
      'LANGUAGE_TEXT_TO_SPEECH',
      'en-us',
    );
    const languageTextSpeechName = this.configService.get<string>(
      'LANGUAGE_TEXT_TO_SPEECH_NAME',
      'en-US-Standard-F',
    );
    const languageModel = this.configService.get<string>(
      'LANGUAGE_MODEL',
      'phone_call',
    );

    this.port = this.configService.get<number>('AUDIOSOCKET_PORT', 9093); // Default to 3001 if not set

    this.speechToTextConfig = {
      config: {
        encoding:
          speechProtos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding
            .LINEAR16,
        sampleRateHertz: this.sampleRateHertz,
        languageCode: languageSpeechText,
        model: languageModel, // Optimized for phone call audio
        useEnhanced: true, // Enables enhanced model for better noise robustness
      },
      interimResults: false, // Set to true if you want interim results
    };

    this.textToSpeechConfig = {
      voice: {
        languageCode: languageTextSpeech,
        name: languageTextSpeechName,
        ssmlGender: 'FEMALE' as const,
      },
      audioConfig: {
        audioEncoding:
          textProtos.google.cloud.texttospeech.v1.AudioEncoding.LINEAR16,
        sampleRateHertz: this.sampleRateHertz,
        pitch: 0,
        speakingRate: 1.19,
      },
    };

    this.greetingsAudio = this.configService.get<string>(
      'AUDIO_GREETINGS',
      'Thank you for calling Mustard, how can I help you?',
    );

    this.language = this.configService.get<string>(
      'LANGUAGE_RACHEL',
      'English',
    );
  }

  onModuleInit() {
    this.speechClient = new SpeechClient();
    this.textToSpeechClient = new TextToSpeechClient();
    this.startServer();
  }

  private startServer() {
    const audioSocket = new AudioSocket();

    audioSocket.onConnection((req, outboundStream) => {
      this.logger.log('new connection from:', req);
      const referenceId = req.ref;

      // Create a new call session for this connection
      const callSession = new CallSession(outboundStream, referenceId);
      // Store the session with a unique key (referenceId or another unique identifier)
      this.activeCalls.set(referenceId, callSession);
      this.logger.log(
        `[${callSession.referenceId}] Active calls: ${this.activeCalls.size}`,
      );

      const audioStream = new PassThrough();

      outboundStream.onData((data) => {
        audioStream.write(data);
      });

      outboundStream.onClose(async () => {
        // Get the call session before removing it
        const session = this.activeCalls.get(referenceId);
        if (session) {
          await this.synthesizeAndPlay(callSession, 'Goodbye!');
          // Remove the call from our map when it is closed
          this.activeCalls.delete(referenceId);
          this.logger.log(
            `[${callSession.referenceId}] Callended. Active calls: ${this.activeCalls.size}`,
          );
        }
        audioStream.end();
        this.logger.log(`[${callSession.referenceId}] AudioSocket closed`);
      });

      outboundStream.onError((err) => {
        // Clean up on error too
        this.activeCalls.delete(referenceId);
        audioStream.end();
        this.logger.error(
          `[${callSession.referenceId}] AudioSocket error:`,
          err,
        );
      });

      // Assuming SLIN16 at 8000 Hz based on STT config
      setTimeout(
        async () =>
          await this.synthesizeAndPlay(callSession, this.greetingsAudio),
        500,
      );

      this.streamToGoogleSTT(audioStream, callSession);
    });

    audioSocket.listen(this.port, () => {
      this.logger.log(`AudioSocket listening on port ${this.port}`);
    });
  }

  private streamToGoogleSTT(
    audioStream: PassThrough,
    callSession: CallSession,
  ) {
    this.logger.log(
      `[${callSession.referenceId}] Starting Google STT Streaming `,
    );

    // VAD configuration
    const vadStream = VAD.createStream({
      audioFrequency: this.sampleRateHertz,
      mode: VAD.Mode.NORMAL, // More selective, reduces false positives from noise
      debounceTime: 200, // Reduced for faster response, adjust based on testing
      silenceThreshold: 0.8, // Higher threshold to filter out background noise
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
          .streamingRecognize(this.speechToTextConfig)
          .on('data', (response) => {
            if (response.results?.[0]?.isFinal) {
              transcription = response.results[0].alternatives[0].transcript;
              this.processTranscription(transcription, callSession);
            }
          })
          .on('error', (err) => {
            this.logger.error(
              `[${callSession.referenceId}] Speech-To-Text stream Error: ${err.message}`,
            );
          })
          .on('end', () => {
            this.logger.log(
              `[${callSession.referenceId}] Speech-To-Text stream ended`,
            );
          });

        // Write the first audio chunk
        this.logger.log(
          `[${callSession.referenceId}] Writing audio chunk to stream for STT`,
        );
        sttStream.write(data.audioData);
      } else if (isSpeaking && data.speech.state) {
        this.logger.log(`[${callSession.referenceId}] Still Speaking`);
        // Continue writing audio chunks during speech
        sttStream.write(data.audioData);
      } else if (data.speech.end && isSpeaking) {
        this.logger.log(`[${callSession.referenceId}] End Speaking`);
        isSpeaking = false;
        sttStream.end();
      }
    });

    vadStream.on('end', () => {
      sttStream?.end();
      this.logger.log(`[${callSession.referenceId}] VAD stream ended`);
    });

    vadStream.on('error', (err) => {
      sttStream.end();
      this.logger.error(`[${callSession.referenceId}] VAD error:`, err);
    });

    audioStream.on('finish', () => {
      vadStream.end();
      this.logger.log(`[${callSession.referenceId}] Audio stream ended`);
    });
  }

  private async processTranscription(
    transcription: string,
    callSession: CallSession,
  ) {
    this.logger.log(`[${callSession.referenceId}] Processing Transcription`);
    if (transcription.trim() !== '') {
      console.log(`[${callSession.referenceId}] ${transcription}`);
      // Stop any ongoing playback
      this.interruptPlayback(callSession);

      const assistantResponse = await this.sendToAssistant(
        callSession,
        transcription,
      );
      await this.synthesizeAndPlay(callSession, assistantResponse);
    } else {
      this.logger.log(`[${callSession.referenceId}] Nothing to transcribe`);
    }
  }

  private interruptPlayback(callSession: CallSession) {
    if (callSession.isPlaying && callSession.playbackTimeoutId) {
      clearTimeout(callSession.playbackTimeoutId); // Cancel the current frame loop
      callSession.isPlaying = false;
      this.logger.log(`[${callSession.referenceId}] Stopped previous playback`);
    }
  }

  private async sendToAssistant(
    callSession: CallSession,
    transcription: string,
  ): Promise<string> {
    try {
      this.interruptPlayback(callSession); // Stop any ongoing playback
      this.logger.log(
        `[${callSession.referenceId}] Sending to OpenAI Assistant: ${transcription}`,
      );
      // Create a new thread
      let response: string = '';
      await axios
        .post('http://127.0.0.1:3001/voice/v2/query', {
          message: transcription,
          language: this.language,
          uniqueId: callSession.referenceId, // from pbx - search CDR
          // assistant or customer service agent
          rachelId: '86034909', // under rachel_tenant
          tenantId: '34975934',
        })
        .then((res) => {
          console.log(res.data.response);
          response = res.data.response;
        });

      return response;
    } catch (error) {
      this.logger.error(
        `[${callSession.referenceId} Error sending to OpenAI Assistant: ${error.message}`,
      );
      return 'I am sorry, I am not able to process your request at the moment.';
    }
  }

  private async synthesizeAndPlay(callSession: CallSession, text: string) {
    this.logger.log(
      `[${callSession.referenceId}] Synthesizing speech: ${text}`,
    );

    // Ensure this call session is still active
    if (!this.activeCalls.has(callSession.referenceId)) {
      this.logger.error(`[${callSession.referenceId}] Call is not active`);
      return;
    }

    // Configure the TTS request for SLIN16 at 8 kHz
    const request = { ...this.textToSpeechConfig, input: { text } };

    try {
      // Synthesize speech
      const [response] =
        await this.textToSpeechClient.synthesizeSpeech(request);
      const audioBuffer = response.audioContent as Buffer;

      this.logger.log(
        `[${callSession.referenceId}] Synthesized audio buffer length: ${audioBuffer.length} bytes`,
      );

      // Asterisk expects 20ms frames for SLIN16 at 8 kHz
      // 8 kHz * 2 bytes/sample * 0.02s = 320 bytes per frame
      const frameSize = 320;
      let offset = 0;

      // Mark as playing for this specific call
      callSession.isPlaying = true;

      // Simulate streaming by sending frames
      const sendFrame = () => {
        // Check if the call session is still active
        if (
          offset >= audioBuffer.length ||
          !callSession.outboundStream ||
          !callSession.isPlaying ||
          !this.activeCalls.has(callSession.referenceId)
        ) {
          callSession.isPlaying = false;
          callSession.playbackTimeoutId = null;
          this.logger.log(
            `[${callSession.referenceId}] Finished streaming synthesized`,
          );
          return;
        }

        // Get the frame from the audio buffer
        const frame = audioBuffer.subarray(offset, offset + frameSize);
        offset += frameSize;

        // Write the frame to the outbound stream
        callSession.outboundStream.write(frame);

        // Store timeout ID in call-specific context
        callSession.playbackTimeoutId = setTimeout(sendFrame, 20);
      };

      // Start sending frames
      sendFrame();
    } catch (error) {
      callSession.isPlaying = false;
      callSession.playbackTimeoutId = null;
      this.logger.error(
        `[${callSession.referenceId}] Error streaming speech for call : ${error.message}`,
      );
    }
  }

  private getAudioAsset(filename: string) {
    return path.join(__dirname, '..', '..', 'assets', 'audio', filename);
  }
}
