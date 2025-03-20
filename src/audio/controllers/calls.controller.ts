import { Body, Controller, Logger, Post } from '@nestjs/common';
import { CallSessionService } from '../services/call-session.service';
import { CallMetadataDto } from '../dto/call-metadata.dto';

@Controller('calls')
export class CallsController {
  private readonly logger = new Logger(CallsController.name);
  constructor(private readonly callSessionService: CallSessionService) {}

  @Post('metadata')
  saveCall(@Body() metadata: CallMetadataDto): {
    success: boolean;
    message: string;
  } {
    this.logger.log(metadata);
    this.callSessionService.saveSession(metadata);
    return {
      success: true,
      message: `Call saved with sessionId: ${metadata.sessionId}`,
    };
  }
}
