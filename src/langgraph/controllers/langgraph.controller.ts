import { Body, Controller, Post } from '@nestjs/common';
import { LangGraphService } from '../services/langgraph.service';
import { ConversationRequest } from '../interfaces/conversation-request';

@Controller('langgraph')
export class LangGraphController {
  constructor(private readonly langGraphService: LangGraphService) {}

  @Post('chat')
  async processMessage(@Body() request: ConversationRequest) {
    // Call the LangGraph service to process the message
    return await this.langGraphService.processMessage(
      request.message,
      request.context!,
    );
  }
}
