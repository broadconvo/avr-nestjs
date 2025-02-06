import { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { AudioService } from './audio.service';
export declare class AudioGateway implements OnGatewayConnection, OnGatewayDisconnect {
    private audioService;
    constructor(audioService: AudioService);
    server: Server;
    handleConnection(client: WebSocket): void;
    handleDisconnect(client: WebSocket): void;
    handleAudioStream(client: WebSocket, data: Buffer): void;
}
