"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var AudioService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AudioService = void 0;
const common_1 = require("@nestjs/common");
const net = require("net");
const axios_1 = require("axios");
let AudioService = AudioService_1 = class AudioService {
    constructor() {
        this.logger = new common_1.Logger(AudioService_1.name);
        this.AUDIO_HOST = process.env.AUDIO_HOST;
        this.AUDIO_PORT = Number(process.env.AUDIO_PORT);
        this.audioBuffer = [];
    }
    onModuleInit() {
    }
    connectToAsterisk() {
        this.logger.log('Connecting to Asterisk AudioSocket ...');
        const client = new net.Socket();
        client.connect(this.AUDIO_PORT, this.AUDIO_HOST, () => {
            this.logger.log(`Connected to Asterisk AudioSocket on ${this.AUDIO_HOST}:${this.AUDIO_PORT}`);
        });
        client.on('data', (data) => {
            this.logger.log(`Received ${data.length} bytes of audio`);
            this.audioBuffer.push(data);
        });
        client.on('close', () => {
            this.logger.warn('AudioSocket connection closed');
        });
        client.on('error', (err) => {
            this.logger.error('AudioSocket error:', err);
        });
    }
    async processAudioBuffer() {
        if (this.audioBuffer.length === 0)
            return;
        const audioData = Buffer.concat(this.audioBuffer);
        this.audioBuffer = [];
        try {
            const response = await axios_1.default.post('https://api.openai.com/v1/audio/transcriptions', audioData, {
                headers: {
                    Authorization: `Bearer YOUR_OPENAI_API_KEY`,
                    'Content-Type': 'audio/wav',
                },
            });
            this.logger.log(`Transcription: ${response.data.text}`);
        }
        catch (error) {
            this.logger.error('Error sending audio to OpenAI:', error);
        }
    }
};
exports.AudioService = AudioService;
exports.AudioService = AudioService = AudioService_1 = __decorate([
    (0, common_1.Injectable)()
], AudioService);
//# sourceMappingURL=audio.service.js.map