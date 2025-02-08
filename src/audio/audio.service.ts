import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Server, Socket } from 'net'; // Import Server and Socket from 'net'
import { v4 as uuidv4 } from 'uuid';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

@Injectable()
export class AudioSocketService implements OnModuleInit {
  private readonly logger = new Logger(AudioSocketService.name);
  private server: Server;
  private connections: Map<string, Socket> = new Map(); // Store connections by UUID
  private readonly port = 9093; // TCP Port

  onModuleInit() {
    this.startServer();
  }

  private startServer() {
    this.server = new Server((socket) => {
      const connectionId = uuidv4(); // Generate a UUID for the connection
      this.logger.log(`Client connected: ${connectionId}`);
      this.connections.set(connectionId, socket);

      const audioBuffer: Buffer[] = [];

      // Handle data from the client
      socket.on('data', (data) => {
        audioBuffer.push(data); // Buffer incoming audio data
        this.handleStreaming(connectionId, audioBuffer, socket);
      });

      // Handle client disconnection
      socket.on('end', () => {
        this.logger.log(`Client disconnected: ${connectionId}`);
        this.connections.delete(connectionId);
      });

      socket.on('error', (err) => {
        this.logger.error(`Socket error: ${err.message}`, err.stack);
        this.connections.delete(connectionId);
        socket.destroy();
      });

      this.sendUuid(socket);
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

  private async handleStreaming(
    connectionId: string,
    audioData: Buffer[],
    socket: Socket,
  ) {
    // Process the audio data here
    this.logger.debug(
      `Received data from ${connectionId}: ${audioData.length} bytes`,
    );
    // Example: Echo the data back to the client (for testing)
    //socket.write(data);

    // Send audio to OpenAI for transcription
    try {
      const audioBuffer = Buffer.concat(audioData);

      const result = await generateText({
        model: openai('gpt-4o-audio-preview'),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is the audio saying?' },
              {
                type: 'file',
                mimeType: 'audio/mpeg', // Adjust MIME type if necessary
                data: audioBuffer,
              },
            ],
          },
        ],
      });

      this.logger.log(`Transcription from OpenAI: ${result.text}`);

      // Send the transcribed text back to the client if needed
      socket.write(result.text);

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

    connection.write(packet);
    this.logger.log(`Sent UUID ${uuid} to client.`);
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
