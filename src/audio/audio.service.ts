import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Server, Socket } from 'net'; // Import Server and Socket from 'net'
import { v4 as uuidv4 } from 'uuid';

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

      // Handle data from the client
      socket.on('data', (data) => {
        this.handleData(connectionId, data, socket);
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
    });

    this.server.listen(this.port, () => {
      this.logger.log(`AudioSocket server listening on port ${this.port}`);
    });

    this.server.on('error', (err) => {
      this.logger.error(`Server error: ${err.message}`, err.stack);
    });
  }

  private handleData(connectionId: string, data: Buffer, socket: Socket) {
    // Process the audio data here
    this.logger.debug(
      `Received data from ${connectionId}: ${data.length} bytes`,
    );
    // Example: Echo the data back to the client (for testing)
    //socket.write(data);

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
