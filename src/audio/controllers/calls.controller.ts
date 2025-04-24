import { Body, Controller, Logger, Post } from '@nestjs/common';
import { CallSessionService } from '../services/call-session.service';
import { CallMetadataDto } from '../dto/call-metadata.dto';
import { ContactLookupService } from '../services/contact-lookup.service';

@Controller('calls')
export class CallsController {
  private readonly logger = new Logger(CallsController.name);
  constructor(
    private readonly callSessionService: CallSessionService,
    private readonly contactLookupService: ContactLookupService,
  ) {}

  @Post('metadata')
  async saveCall(@Body() metadata: CallMetadataDto): Promise<{
    success: boolean;
    message: string;
    data: CallMetadataDto;
  }> {
    // Look up contact information if we have a phone number
    if (metadata.callerId) {
      try {
        const contactInfo = await this.contactLookupService.lookupContact(
          metadata.callerId,
        );

        if (contactInfo.contactPhone) {
          // Add contact information to the metadata
          metadata.callerName = contactInfo.contactFirstname;

          this.logger.log(
            `Contact found: ${contactInfo.contactName} for caller: ${metadata.callerId}`,
          );
        } else this.logger.log(`New caller: ${metadata.callerId}`);
      } catch (error) {
        this.logger.warn(
          `Failed to lookup contact for ${metadata.callerId}: ${error.message}`,
        );
      }
    }

    this.callSessionService.saveSession(metadata);
    return {
      success: true,
      message: `Call saved with sessionId: ${metadata.sessionId}`,
      data: metadata,
    };
  }
}
