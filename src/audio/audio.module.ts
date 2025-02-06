import { Module } from '@nestjs/common';
import { AudioGateway } from './audio.gateway';

@Module({
  providers: [AudioGateway],
  exports: [AudioGateway],
})
export class AudioModule {}
