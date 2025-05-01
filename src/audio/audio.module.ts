import { Module } from '@nestjs/common';
import { CallsController } from './controllers/calls.controller';
import { CallSessionService } from './services/call-session.service';
import { AudioSocketService } from './services/audiosocket.service';
import { ConfigModule } from '@nestjs/config';
import { ContactLookupController } from './controllers/contact-lookup.controller';
import { ContactLookupService } from './services/contact-lookup.service';
import { LangGraphModule } from '../langgraph/langgraph.module';
import { InvoiceService } from '../langgraph/services/invoice.service';

@Module({
  imports: [ConfigModule, LangGraphModule],
  controllers: [CallsController, ContactLookupController],
  providers: [
    AudioSocketService,
    CallSessionService,
    ContactLookupService,
    InvoiceService,
  ],
  exports: [AudioSocketService, CallSessionService, ContactLookupService],
})
export class AudioModule {}
