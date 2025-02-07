import { Module } from '@nestjs/common';
import { AudioSocketService } from './audio.service';

@Module({
  providers: [AudioSocketService],
})
export class AudioModule {}
