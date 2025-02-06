import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
} from '@nestjs/websockets';
import { Server } from 'ws';

@WebSocketGateway({ path: '/audio-stream' })
export class AudioGateway {
  @WebSocketServer()
  server: Server;

  @SubscribeMessage('audio')
  handleAudio(@MessageBody() data: Buffer) {
    console.log('Received audio chunk:', data.toString());
    // Process, store, or forward the audio data
  }
}
