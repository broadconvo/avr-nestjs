import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: '*', // Allow connections from any origin
  },
})
export class AudioGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(AudioGateway.name);

  @WebSocketServer()
  server: Server;

  afterInit(server: Server) {
    this.logger.log('WebSocket server initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
    client.emit('welcome', 'Welcome to the WebSocket server!');
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('openai')
  handleMessage(client: Socket, payload: string): void {
    this.logger.log(`Received message: ${payload} from ${client.id}`);
    // Broadcast the message to all connected clients
    this.server.emit('message', payload);
  }
}
