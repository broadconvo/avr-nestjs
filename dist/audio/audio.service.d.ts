import { OnModuleInit } from '@nestjs/common';
import { Socket } from 'net';
export declare class AudioSocketService implements OnModuleInit {
    private readonly logger;
    private server;
    private connections;
    private readonly port;
    onModuleInit(): void;
    private startServer;
    private handleData;
    sendUuid(connection: Socket): void;
    sendData(connectionId: string, data: Buffer): void;
}
