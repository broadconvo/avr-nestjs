import { Module } from '@nestjs/common';
import { AudioGateway } from './audio.gateway';
import { AudioService } from './audio.service';

@Module({
  providers: [AudioGateway, AudioService],
})
export class AudioModule {}
