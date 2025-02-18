import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Server, Socket } from 'net'; // Import Server and Socket from 'net'
import { v4 as uuidv4 } from 'uuid';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import * as ffmpeg from 'fluent-ffmpeg';
import { PassThrough } from 'stream';
import { protos, SpeechClient } from '@google-cloud/speech';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AudioSocket } from '@fonoster/streams';
import * as VAD from 'node-vad';

@Injectable()
export class AudioSocketService implements OnModuleInit {
  private readonly logger = new Logger(AudioSocketService.name);
  private server: Server;
  private connections: Map<string, Socket> = new Map(); // Store connections by UUID
  private readonly port = 9093; // TCP Port
  private openai: any;
  private speechClient: SpeechClient;
  private vadInstance: VAD;

  onModuleInit() {
    this.speechClient = new SpeechClient();
    this.openai = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.startServer();
  }

  createStream(options: VAD.StreamOptions): any {
    return VAD.createStream(options);
  }

  private startServer() {
    const loadingAudioPath = path.join(
      __dirname,
      '..',
      '..',
      'assets',
      'audio',
      'greetings.wav',
    );

    const audioStream = new PassThrough();
    const audioSocket = new AudioSocket();

    audioSocket.onConnection(async (req, res) => {
      this.logger.log('new connection from:', req.ref);

      res.onData((data) => {
        audioStream.write(data);

        // Handle incoming audio data and send it back to the client
        res.write(data);
      });

      res.onClose(() => {
        audioStream.end();
        this.logger.log('connection closed');
      });

      res.onError((err) => {
        audioStream.end();
        console.error('connection error:', err);
      });

      this.streamToGoogleSTT(audioStream);

      // plays SLIN16 4kHz audio mono channel
      // Utility for playing audio files
      await res.play(loadingAudioPath);
    });

    audioSocket.listen(this.port, () => {
      this.logger.log(`server listening on port ${this.port}`);
    });
  } // end startServer

  private handleStreaming(
    connectionId: string,
    audioData: Buffer[],
    socket: Socket,
  ) {
    // Process the audio data here
    this.logger.debug(
      `Received data from ${connectionId}: ${audioData.length} bytes`,
    );
    // Example: Echo the data back to the client (for testing)
    // socket.write(data);

    // Send audio to OpenAI for transcription
    try {
      const slin16Buffer = Buffer.concat(audioData); // Combine SLIN16 audio frames
      // const wavBuffer = await this.convertSlin16ToWav(slin16Buffer); // Convert to WAV

      // const result = await generateText({
      //   model: this.openai('gpt-4o-audio-preview', { simulateStreaming: true }),
      //   messages: [
      //     {
      //       role: 'user',
      //       content: [
      //         { type: 'text', text: 'What is the audio saying?' },
      //         {
      //           type: 'file',
      //           mimeType: 'audio/wav', // Adjust MIME type if necessary
      //           data: wavBuffer,
      //         },
      //       ],
      //     },
      //   ],
      // });

      // this.logger.log(`Transcription from OpenAI: ${result.text}`);

      // Send the transcribed text back to the client if needed
      // socket.write(slin16Buffer);

      // Clear buffer after processing
      audioData.length = 0;
    } catch (error) {
      this.logger.error(`Error streaming audio to OpenAI: ${error.message}`);
    }

    //TODO: Implement your audio processing logic here
    // - Volume calculation
    // - Speech detection
    // - Send to Deepgram
    // - Receive TTS
    // - Stream back to Asterisk
  }

  sendUuid(connection: Socket): void {
    const uuid = uuidv4();
    const uuidBuffer = Buffer.from(uuid.replace(/-/g, ''), 'hex'); // Convert UUID string to Buffer
    const type = 0x01; // Packet Type
    const length = 16; // Packet Length

    // Create the packet using Buffer.concat
    const typeBuffer = Buffer.alloc(1);
    typeBuffer.writeUInt8(type, 0);

    const lengthBuffer = Buffer.alloc(2);
    lengthBuffer.writeUInt16BE(length, 0); // Big-endian

    const packet = Buffer.concat([typeBuffer, lengthBuffer, uuidBuffer]);

    // connection.write(packet);
    // this.logger.log(`Sent UUID ${uuid} to client.`);
  }

  private streamToGoogleSTT(audioStream: PassThrough) {
    this.logger.log('Starting Google STT Streaming...');

    /**
     * -----------------------------------------------------------------
     * Save the original SLIN8 audio to a file for debugging
     * -----------------------------------------------------------------
     */
    // dist/assets/audio/debug_audio.raw
    const filePath = path.join(
      __dirname,
      '..',
      'assets',
      'audio',
      'debug_audio.raw',
    );
    // Ensure the directory exists before writing
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const writeStream = fs.createWriteStream(filePath);
    this.logger.log(`Saving raw SLIN8 audio to: ${filePath}`);

    /**
     * Voice Activity Detection
     */
    // Configure node-vad (you can choose between NORMAL, AGGRESSIVE, VERY_AGGRESSIVE)
    const vadStream = VAD.createStream({
      audioFrequency: 8000,
      mode: VAD.Mode.NORMAL,
      debounceTime: 1000, // 1 second of silence before we consider speech ended
    });

    let isSpeaking = false; // Track whether speech is ongoing
    let silenceTimeout: NodeJS.Timeout | null = null;

    // Pipe the audio stream into the VAD instance.
    // The VAD instance is a transform stream that passes through the audio data.
    audioStream.pipe(vadStream);
    vadStream
      .on('data', (data: VAD.Result) => {
        if (data.speech.start) {
          if (!isSpeaking) {
            this.logger.log(`Speech started, writing to file.`);
            isSpeaking = true;

            // ✅ Resume writing if speech resumes
            audioStream.pipe(writeStream);
          }

          // ✅ Clear any existing silence timeout to prevent premature closing
          if (silenceTimeout) {
            clearTimeout(silenceTimeout);
            silenceTimeout = null;
          }
        } // end of speaking

        if (data.speech.end) {
          this.logger.log('Silence detected.');

          // ✅ Delay closing the stream to prevent cutting off speech
          silenceTimeout = setTimeout(() => {
            if (isSpeaking) {
              this.logger.log('Stopping audio recording due to silence.');
              isSpeaking = false;

              // ✅ Unpipe the stream and close the file
              audioStream.unpipe(writeStream);
              writeStream.end();
            }
          }, 2000); // 2 seconds of silence before stopping
        } // end of silence
      })
      .on('end', () => {
        writeStream.end();
        this.logger.log('Audio stream ended');
      })
      .on('error', (err) => {
        writeStream.end();
        this.logger.error('Error processing audio stream:', err);
      });

    /**
     * -----------------------------------------------------------------
     * Convert SLIN8 to LINEAR16 using FFmpeg on the conversion clone
     * -----------------------------------------------------------------
     */
    // this.logger.log(
    //   'Converting SLIN8 (8kHz PCM) to LINEAR16 (8kHz, 16-bit PCM) using FFmpeg...',
    // );
    // const audioStreamForConversion = new PassThrough();
    // audioStreamForConversion.write(audioStream);
    //
    // // Configure Google STT request
    // // LINEAR16 (16-bit PCM) audio at 8kHz sample rate
    // const streamingConfig: protos.google.cloud.speech.v1.IStreamingRecognitionConfig =
    //   {
    //     config: {
    //       encoding:
    //         protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding
    //           .LINEAR16,
    //       sampleRateHertz: 8000, // 8kHz sample rate
    //       languageCode: 'en-US',
    //       enableAutomaticPunctuation: true,
    //     },
    //     interimResults: true, // Get partial transcriptions in real-time
    //   };
    //
    // this.logger.log('Transcribing with Google STT...');
    // const recognizeStream = this.speechClient
    //   .streamingRecognize(streamingConfig)
    //   .on('error', (err) => {
    //     this.logger.error(`Google STT Error: ${err.message}`);
    //   })
    //   .on('data', (data) => {
    //     console.log(JSON.stringify(data, null, 2));
    //
    //     if (data.results?.[0]?.alternatives?.[0]?.transcript) {
    //       const transcription = data.results[0].alternatives[0].transcript;
    //       this.logger.log(`Live Transcription: ${transcription}`);
    //
    //       // Send transcription back to the client (Asterisk or WebSocket)
    //       // socket.write(`Transcription: ${transcription}\n`);
    //     }
    //   });
    //
    // // Pipe the converted audio stream to the Google STT recognize stream
    // audioStreamForConversion.pipe(recognizeStream);
  } // end of function

  private convertSlin16ToWav(slin16Buffer: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const inputStream = new PassThrough();
      const outputStream = new PassThrough();
      const chunks: Buffer[] = [];

      inputStream.end(slin16Buffer);

      ffmpeg(inputStream)
        .inputFormat('s16le') // SLIN16 format
        .audioFrequency(16000) // 16 kHz sample rate
        .audioChannels(1) // Mono
        .audioCodec('pcm_s16le') // PCM codec
        .format('wav') // Output format: WAV
        .on('error', reject)
        .on('end', () => resolve(Buffer.concat(chunks)))
        .pipe(outputStream);

      outputStream.on('data', (chunk) => chunks.push(chunk));
    });
  }

  // Example method to send data to a specific connection
  sendData(connectionId: string, data: Buffer) {
    const socket = this.connections.get(connectionId);
    if (socket) {
      socket.write(data);
    } else {
      this.logger.warn(`Connection ${connectionId} not found.`);
    }
  }
}
