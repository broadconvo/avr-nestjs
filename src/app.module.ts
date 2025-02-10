import { Module } from '@nestjs/common';
import { AudioModule } from './audio/audio.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [AudioModule, ConfigModule.forRoot()],
  controllers: [],
  providers: [],
})
export class AppModule {}
