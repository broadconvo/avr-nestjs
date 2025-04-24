import { Controller, Get, Param, Logger } from '@nestjs/common';
import { ContactLookupService } from '../services/contact-lookup.service';
import { ContactResponseDto } from '../dto/contact-lookup.dto';

@Controller('contacts')
export class ContactLookupController {
  private readonly logger = new Logger(ContactLookupController.name);

  constructor(private readonly contactLookupService: ContactLookupService) {}

  @Get('lookup/:callerId')
  async lookupContact(
    @Param('callerId') callerId: string,
  ): Promise<ContactResponseDto> {
    this.logger.log(`Looking up contact for caller ID: ${callerId}`);
    return this.contactLookupService.lookupContact(callerId);
  }
}
