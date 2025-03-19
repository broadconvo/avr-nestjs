import { Body, Controller, Post } from '@nestjs/common';
import { CallSessionService } from '../services/call-session.service';
import { CallMetadataDto } from '../dto/call-metadata.dto';

@Controller('calls')
export class CallsController {
  constructor(private readonly callSessionService: CallSessionService) {}

  @Post('metadata')
  saveCall(@Body() metadata: CallMetadataDto): {
    success: boolean;
    message: string;
  } {
    this.callSessionService.saveSession(metadata);
    return {
      success: true,
      message: `Call saved with sessionId: ${metadata.sessionId}`,
    };
  }
}
