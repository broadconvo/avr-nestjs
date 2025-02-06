import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { AudioService } from './audio.service';

@WebSocketGateway(8080)
export class AudioGateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(private audioService: AudioService) {}

  @WebSocketServer()
  server: Server;

  handleConnection(client: WebSocket) {
    console.log('Client connected');
    client.on('message', (data: Buffer) => {
      this.handleAudioStream(client, data);
    });
  }

  handleDisconnect(client: WebSocket) {
    console.log('Client disconnected');
  }

  handleAudioStream(client: WebSocket, data: Buffer) {
    this.audioService.processAudio(data);
  }
}
