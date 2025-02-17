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

@Injectable()
export class AudioSocketService implements OnModuleInit {
  private readonly logger = new Logger(AudioSocketService.name);
  private server: Server;
  private connections: Map<string, Socket> = new Map(); // Store connections by UUID
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
    const loadingAudioPath = path.join(
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

      res.onData((data) => {
        // Handle incoming audio data and send it back to the client
        res.write(data);
      });

      res.onClose(() => {
        this.logger.log('connection closed');
      });

      res.onError((err) => {
        console.error('connection error:', err);
      });

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

  private streamToGoogleSTT(audioStream: PassThrough, socket: Socket) {
    this.logger.log('Starting Google STT Streaming...');

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

    // Create two cloned streams from the original audioStream:
    const audioStreamForFile = new PassThrough();
    const audioStreamForConversion = new PassThrough();
    // Pipe the original stream into both clones
    audioStream.pipe(audioStreamForFile);
    audioStream.pipe(audioStreamForConversion);

    // Pipe one clone to file to save the raw SLIN8 audio
    audioStreamForFile.pipe(writeStream);
    this.logger.log(`Saving raw SLIN8 audio to: ${filePath}`);

    // Convert SLIN8 to LINEAR16 using FFmpeg on the conversion clone
    const convertedAudioStream = new PassThrough();

    this.logger.log(
      'Converting SLIN8 (8kHz PCM) to LINEAR16 (8kHz, 16-bit PCM) using FFmpeg...',
    );
    ffmpeg(audioStreamForConversion)
      .inputFormat('ulaw') // Input is SLIN (Signed Linear PCM)
      .audioFrequency(8000) // 8kHz sample rate
      .audioChannels(1) // Mono audio
      .audioCodec('pcm_s16le') // Convert to 16-bit PCM (LINEAR16)
      .format('wav') // Output as WAV container (required by Google STT)
      .on('error', (err) => this.logger.error(`FFmpeg Error: ${err.message}`))
      .pipe(convertedAudioStream);

    // Configure Google STT request
    const streamingConfig: protos.google.cloud.speech.v1.IStreamingRecognitionConfig =
      {
        config: {
          encoding:
            protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding.MULAW,
          sampleRateHertz: 8000, // 8kHz sample rate
          languageCode: 'en-US',
          enableAutomaticPunctuation: true,
        },
        interimResults: true, // Get partial transcriptions in real-time
      };

    this.logger.log('Transcribing with Google STT...');
    const recognizeStream = this.speechClient
      .streamingRecognize(streamingConfig)
      .on('error', (err) => {
        this.logger.error(`Google STT Error: ${err.message}`);
      })
      .on('data', (data) => {
        console.log(JSON.stringify(data, null, 2));
        if (data.results?.[0]?.alternatives?.[0]?.transcript) {
          const transcription = data.results[0].alternatives[0].transcript;
          this.logger.log(`Live Transcription: ${transcription}`);

          // Send transcription back to the client (Asterisk or WebSocket)
          socket.write(`Transcription: ${transcription}\n`);
        }
      });

    // Pipe the converted audio stream to the Google STT recognize stream
    convertedAudioStream.pipe(recognizeStream);
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
