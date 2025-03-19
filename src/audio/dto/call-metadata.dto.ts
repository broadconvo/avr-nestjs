import { IsString } from '@nestjs/class-validator';

export class CallMetadataDto {
  @IsString()
  callerId: string;

  @IsString()
  callerName: string;

  @IsString()
  sessionId: string;
}
