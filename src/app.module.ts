import { Module } from '@nestjs/common';
import { AudioModule } from './audio/audio.module';

@Module({
  imports: [AudioModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
