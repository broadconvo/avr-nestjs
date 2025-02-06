"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AudioGateway = void 0;
const websockets_1 = require("@nestjs/websockets");
const ws_1 = require("ws");
const audio_service_1 = require("./audio.service");
let AudioGateway = class AudioGateway {
    constructor(audioService) {
        this.audioService = audioService;
    }
    handleConnection(client) {
        console.log('Client connected');
        client.on('message', (data) => {
            this.handleAudioStream(client, data);
        });
    }
    handleDisconnect(client) {
        console.log('Client disconnected');
    }
    handleAudioStream(client, data) {
        this.audioService.processAudio(data);
    }
};
exports.AudioGateway = AudioGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", typeof (_a = typeof ws_1.Server !== "undefined" && ws_1.Server) === "function" ? _a : Object)
], AudioGateway.prototype, "server", void 0);
exports.AudioGateway = AudioGateway = __decorate([
    (0, websockets_1.WebSocketGateway)(8080),
    __metadata("design:paramtypes", [audio_service_1.AudioService])
], AudioGateway);
//# sourceMappingURL=audio.gateway.js.map