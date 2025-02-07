"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var AudioSocketService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AudioSocketService = void 0;
const common_1 = require("@nestjs/common");
const net_1 = require("net");
const uuid_1 = require("uuid");
let AudioSocketService = AudioSocketService_1 = class AudioSocketService {
    constructor() {
        this.logger = new common_1.Logger(AudioSocketService_1.name);
        this.connections = new Map();
        this.port = 9093;
    }
    onModuleInit() {
        this.startServer();
    }
    startServer() {
        this.server = new net_1.Server((socket) => {
            const connectionId = (0, uuid_1.v4)();
            this.logger.log(`Client connected: ${connectionId}`);
            this.connections.set(connectionId, socket);
            socket.on('data', (data) => {
                this.handleData(connectionId, data, socket);
            });
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
    handleData(connectionId, data, socket) {
        this.logger.debug(`Received data from ${connectionId}: ${data.length} bytes`);
    }
    sendUuid(connection) {
        const uuid = (0, uuid_1.v4)();
        const uuidBuffer = Buffer.from(uuid.replace(/-/g, ''), 'hex');
        const type = 0x01;
        const length = 16;
        const typeBuffer = Buffer.alloc(1);
        typeBuffer.writeUInt8(type, 0);
        const lengthBuffer = Buffer.alloc(2);
        lengthBuffer.writeUInt16BE(length, 0);
        const packet = Buffer.concat([typeBuffer, lengthBuffer, uuidBuffer]);
        connection.write(packet);
        this.logger.log(`Sent UUID ${uuid} to client.`);
    }
    sendData(connectionId, data) {
        const socket = this.connections.get(connectionId);
        if (socket) {
            socket.write(data);
        }
        else {
            this.logger.warn(`Connection ${connectionId} not found.`);
        }
    }
};
exports.AudioSocketService = AudioSocketService;
exports.AudioSocketService = AudioSocketService = AudioSocketService_1 = __decorate([
    (0, common_1.Injectable)()
], AudioSocketService);
//# sourceMappingURL=audio.service.js.map