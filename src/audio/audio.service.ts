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
    this.server = new Server((socket) => {
      const connectionId = uuidv4(); // Generate a UUID for the connection
      this.logger.log(`Client connected: ${connectionId}`);
      this.connections.set(connectionId, socket);

      const audioStream = new PassThrough(); // Stream SLIN16 data

      // Handle data from the client
      socket.on('data', (data) => {
        audioStream.write(data); // Push SLIN16 data
      });

      // Handle client disconnection
      socket.on('end', () => {
        this.logger.log(`Client disconnected: ${connectionId}`);
        this.connections.delete(connectionId);
        audioStream.end(); // Close stream
        this.streamToGoogleSTT(audioStream, socket); // Start STT
      });

      socket.on('error', (err) => {
        this.logger.error(`Socket error: ${err.message}`, err.stack);
        this.connections.delete(connectionId);
        socket.destroy();
      });

      // this.sendUuid(socket);
    }); // end new Server

    /*
     * Listeners for the 'error' and 'listening' events
     */

    this.server.listen(this.port, () => {
      this.logger.log(`AudioSocket server listening on port ${this.port}`);
    });

    this.server.on('error', (err) => {
      this.logger.error(`Server error: ${err.message}`, err.stack);
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

    // Save received audio for debugging
    const directoryPath = path.join(__dirname, '..', 'assets/audio');
    this.logger.log(directoryPath);

    if (!fs.existsSync(directoryPath)) {
      fs.mkdirSync(directoryPath, { recursive: true });
    }

    const filePath = path.join(directoryPath, `debug_audio_${Date.now()}.raw`);
    const writeStream = fs.createWriteStream(filePath);
    audioStream.pipe(writeStream);

    this.logger.log(`Saving raw audio to ${filePath}`);

    // Verify that the stream is receiving data
    audioStream.on('data', (chunk) => {
      this.logger.debug(`Received chunk of ${chunk.length} bytes`);
    });

    const request: protos.google.cloud.speech.v1.IStreamingRecognitionConfig = {
      config: {
        encoding:
          protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding
            .MULAW, // SLIN16 is 16-bit PCM
        sampleRateHertz: 8000, // Standard for SLIN16
        languageCode: 'en-US',
      },
      interimResults: true, // Get partial transcriptions
    };

    const recognizeStream = this.speechClient
      .streamingRecognize(request)
      .on('error', (err) => {
        this.logger.error(`Google STT Error: ${err.message}`);
      })
      .on('data', (data) => {
        console.log(JSON.stringify(data, null, 2));
        const transcription = data.results
          .map((result: any) => {
            return result.alternatives[0].transcript;
          })
          .join('\n');

        this.logger.log(`Transcription: ${transcription}`);
        // socket.write(`Transcription: ${transcription}\n`); // Send back text
      });

    // ✅ Fix: Ensure `audioStream` pipes to `recognizeStream`
    audioStream.pipe(recognizeStream);
  }

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
