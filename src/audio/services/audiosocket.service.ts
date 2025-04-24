import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PassThrough } from 'stream';
import { protos as speechProtos, SpeechClient } from '@google-cloud/speech';
import {
  protos as textProtos,
  TextToSpeechClient,
} from '@google-cloud/text-to-speech';
import { AudioSocket } from '@fonoster/streams';
import * as VAD from 'node-vad';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { CallSessionService } from './call-session.service';
import { CallSession } from '../entities/call-session.entity';

@Injectable()
export class AudioSocketService implements OnModuleInit {
  private readonly logger = new Logger(AudioSocketService.name);
  private readonly port: number; // Websocket TCP Port

  private readonly sampleRateHertz = 8000;
  private speechClient: SpeechClient;
  private textToSpeechClient: TextToSpeechClient;
  private speechToTextConfig: speechProtos.google.cloud.speech.v1.IStreamingRecognitionConfig;
  private readonly textToSpeechConfig: textProtos.google.cloud.texttospeech.v1.ISynthesizeSpeechRequest;

  private readonly audioGreetings: string;
  private readonly audioError: string;

  private readonly rachelLanguage: string;
  private readonly rachelUrl: string;
  private rachelTenantId: string;
  private rachelId: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly callSessionService: CallSessionService,
  ) {
    this.rachelUrl = this.configService.get<string>(
      'RACHEL_URL',
      'http://127.0.0.1:3001/voice/v2/query',
    );
    this.rachelLanguage = this.configService.get<string>(
      'RACHEL_LANGUAGE',
      'English',
    );
    const languageSpeechText = this.configService.get<string>(
      'LANGUAGE_SPEECH_TO_TEXT',
      'en-US',
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

    this.port = this.configService.get<number>('AUDIOSOCKET_PORT', 9093);

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

    this.audioGreetings = this.configService.get<string>(
      'AUDIO_GREETINGS',
      'Thank you for calling Mustard, how can I help you?',
    );
    this.audioError = this.configService.get<string>(
      'AUDIO_ERROR',
      'I apologize, but I encountered an error. Please try again later.',
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
      const sessionId = req.ref;

      // Try to get the call session from the service using the sessionId
      const callSession = this.callSessionService.getSession(sessionId);

      console.log('callSession', callSession);
      if (!callSession) {
        this.logger.error(`[${sessionId}] Call session not found`);
        outboundStream.hangup();
        throw new Error('Call session not found');
      } else {
        this.logger.log(
          `[${sessionId}] New call from ${callSession.metadata.DID}`,
        );

        axios
          .get(
            `http://127.0.0.0:3002/api/broadconvo/phones/${callSession.metadata.DID}`,
          )
          .then((res) => {
            this.rachelId = res.data.data.rachel_id;
            this.rachelTenantId = res.data.data.tenant_id;
          })
          .catch((err) => {
            this.logger.error(
              `[${sessionId}] Error getting rachel_id and tenant_id: ${err.message}`,
            );
          });
        // Update the call session with the new outbound stream
        callSession.outboundStream = outboundStream;
        this.logger.log(
          `[${sessionId}] Call session found and updated with new outbound stream`,
        );
      }

      this.logger.log(
        `[${sessionId}] Active calls: ${this.callSessionService.getActiveSessions().length}`,
      );

      const audioStream = new PassThrough();

      // data is a buffer audio frames that came from the outboundStream.write()
      outboundStream.onData((data) => {
        audioStream.write(data);
      });

      outboundStream.onClose(async () => {
        if (callSession) {
          await this.synthesizeAndPlay(callSession, 'Goodbye!');
          // Remove the call from our map when it is closed
          this.callSessionService.deleteSession(sessionId);
          this.logger.log(
            `[${sessionId}] Call ended. Active calls: ${this.callSessionService.getActiveSessions().length}`,
          );
        }
        audioStream.end();
        this.logger.log(`[${sessionId}] AudioSocket closed`);
      });

      outboundStream.onError((err) => {
        // Clean up on error too
        this.callSessionService.deleteSession(sessionId);
        audioStream.end();
        this.logger.error(`[${sessionId}] AudioSocket error: `, err);
      });

      // if there is callerId in metadata, then add Hi {customerName} to the audio greeting
      let audioGreeting = this.audioGreetings;
      if (callSession.metadata.callerId) {
        audioGreeting = `Hi ${callSession.metadata.callerName}, ${audioGreeting}`;
      }
      // wait 0.5seconds before playing greetings audio
      setTimeout(
        async () => await this.synthesizeAndPlay(callSession, audioGreeting),
        500,
      );

      this.streamToGoogleSTT(audioStream, callSession);
    });

    audioSocket.listen(this.port, () => {
      this.logger.log(`🚀 AudioSocket listening on port ${this.port}`);
    });
  }

  private streamToGoogleSTT(
    audioStream: PassThrough,
    callSession: CallSession,
  ) {
    const callSessionId = callSession.metadata.sessionId;
    this.logger.log(`[${callSessionId}] Starting Google STT Streaming `);

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
              `[${callSessionId}] Speech-To-Text stream Error: ${err.message}`,
            );
          })
          .on('end', () => {
            this.logger.log(`[${callSessionId}] Speech-To-Text stream ended`);
          });

        // Write the first audio chunk
        this.logger.log(
          `[${callSessionId}] Writing audio chunk to stream for STT`,
        );
        sttStream.write(data.audioData);
      } else if (isSpeaking && data.speech.state) {
        // this.logger.log(`[${callSessionId}] Still Speaking`);
        // Continue writing audio chunks during speech
        sttStream.write(data.audioData);
      } else if (data.speech.end && isSpeaking) {
        // this.logger.log(`[${callSessionId}] End Speaking`);
        isSpeaking = false;
        sttStream.end();
      }
    });

    vadStream.on('end', () => {
      sttStream?.end();
      this.logger.log(`[${callSessionId}] VAD stream ended`);
    });

    vadStream.on('error', (err) => {
      sttStream.end();
      this.logger.error(`[${callSessionId}] VAD error:`, err);
    });

    audioStream.on('finish', () => {
      vadStream.end();
      this.logger.log(`[${callSessionId}] Audio stream ended`);
    });
  }

  private async processTranscription(
    transcription: string,
    callSession: CallSession,
  ) {
    const callSessionId = callSession.metadata.sessionId;
    this.logger.log(`[${callSessionId}] Processing Transcription`);
    if (transcription.trim() !== '') {
      console.log(`[${callSessionId}] ${transcription}`);
      // Stop any ongoing playback
      this.interruptPlayback(callSession);

      const assistantResponse = await this.sendToAssistant(
        callSession,
        transcription,
      );
      await this.synthesizeAndPlay(callSession, assistantResponse);
    } else {
      this.logger.log(`[${callSessionId}] Nothing to transcribe`);
    }
  }

  private interruptPlayback(callSession: CallSession) {
    if (callSession.isPlaying && callSession.playbackTimeoutId) {
      clearTimeout(callSession.playbackTimeoutId); // Cancel the current frame loop
      callSession.isPlaying = false;
      this.logger.log(
        `[${callSession.metadata.sessionId}] Stopped previous playback`,
      );
    }
  }

  private async sendToAssistant(
    callSession: CallSession,
    transcription: string,
  ): Promise<string> {
    const callSessionId = callSession.metadata.sessionId;
    try {
      this.interruptPlayback(callSession); // Stop any ongoing playback
      this.logger.log(
        `[${callSessionId}] Sending to Rachel (OpenAI): ${transcription}`,
      );
      // Create a new thread
      let response: string = '';
      await axios
        .post(this.rachelUrl, {
          message: transcription,
          language: this.rachelLanguage,
          uniqueId: callSessionId, // from pbx - search CDR
          // customer service agent or receptionist
          rachelId: this.rachelId,
          tenantId: this.rachelTenantId,
        })
        .then((res) => {
          console.log(res.data.response);
          response = res.data.response;
        });

      return response;
    } catch (error) {
      this.logger.error(
        `[${callSessionId} Error sending to Rachel (OpenAI): ${error.message}`,
      );
      return this.audioError;
    }
  }

  private async synthesizeAndPlay(callSession: CallSession, text: string) {
    const callSessionId = callSession.metadata.sessionId;
    this.logger.log(`[${callSessionId}] Synthesizing speech: ${text}`);

    // Validate the stream before using it
    if (!callSession.outboundStream) {
      this.logger.error(
        `No outboundStream available for session ${callSession.metadata.sessionId}`,
      );
      return;
    }

    // Ensure this call session is still active
    if (callSession.isExpired) {
      this.logger.error(`[${callSessionId}] Call session is already expired`);
      return;
    }

    // Configure the TTS request for SLIN16 at 8 kHz
    const request = { ...this.textToSpeechConfig, input: { text } };

    try {
      // Validate and log outboundStream status
      if (!callSession.outboundStream) {
        this.logger.error(
          `OutboundStream is null for session ${callSessionId}`,
        );
        return;
      }

      // Synthesize speech
      const [response] =
        await this.textToSpeechClient.synthesizeSpeech(request);
      const audioBuffer = response.audioContent as Buffer;

      this.logger.log(
        `[${callSessionId}] Synthesized audio buffer length: ${audioBuffer.length} bytes`,
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
          !callSession.isPlaying
        ) {
          callSession.isPlaying = false;
          callSession.playbackTimeoutId = null;
          this.logger.log(`[${callSessionId}] Finished synthesizing`);
          return;
        }

        // Get the frame from the audio buffer
        const frame = audioBuffer.subarray(offset, offset + frameSize);
        offset += frameSize;

        // Write the frame to the outbound stream
        callSession.outboundStream.write(frame);

        // Schedule the next frame
        callSession.playbackTimeoutId = setTimeout(sendFrame, 20);
      };

      // Start sending frames
      sendFrame();
    } catch (error) {
      callSession.isPlaying = false;
      callSession.playbackTimeoutId = null;
      this.logger.error(
        `[${callSessionId}] Error synthesizing text to speech: ${error.message}`,
      );
    }
  }
}
