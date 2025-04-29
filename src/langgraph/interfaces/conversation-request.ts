import { CallMetadataDto } from '../../audio/dto/call-metadata.dto';

export interface ConversationRequest {
  message: string;
  context?: CallMetadataDto;
}
