import { Module } from '@nestjs/common';
import { CallsController } from './controllers/calls.controller';
import { CallSessionService } from './services/call-session.service';
import { AudioSocketService } from './services/audiosocket.service';
import { ConfigModule } from '@nestjs/config';
import { ContactLookupController } from './controllers/contact-lookup.controller';
import { ContactLookupService } from './services/contact-lookup.service';

@Module({
  imports: [ConfigModule],
  controllers: [CallsController, ContactLookupController],
  providers: [AudioSocketService, CallSessionService, ContactLookupService],
  exports: [AudioSocketService, CallSessionService, ContactLookupService],
})
export class AudioModule {}
