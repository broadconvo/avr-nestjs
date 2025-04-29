import { IsString } from '@nestjs/class-validator';
import { Optional } from '@nestjs/common';

export class CallMetadataDto {
  @IsString()
  DID: string;

  @IsString()
  @Optional()
  callerId?: string;

  @IsString()
  @Optional()
  callerName?: string;

  @IsString()
  sessionId: string;

  @Optional()
  invoiceId?: string;
}
