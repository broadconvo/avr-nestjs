import { Module } from '@nestjs/common';
import { CallsController } from './controllers/calls.controller';
import { CallSessionService } from './services/call-session.service';
import { AudioSocketService } from './services/audiosocket.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  controllers: [CallsController],
  providers: [AudioSocketService, CallSessionService],
  exports: [AudioSocketService, CallSessionService],
})
export class AudioModule {}
