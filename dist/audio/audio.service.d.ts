import { OnModuleInit } from '@nestjs/common';
export declare class AudioService implements OnModuleInit {
    private readonly logger;
    private readonly AUDIO_HOST;
    private readonly AUDIO_PORT;
    private audioBuffer;
    onModuleInit(): void;
    private connectToAsterisk;
    private processAudioBuffer;
}
