import { IsBoolean, IsString } from '@nestjs/class-validator';
import { Optional } from '@nestjs/common';
import { Invoice } from '../../langgraph/interfaces/invoice';
import { ShippingInfo } from '../../langgraph/interfaces/shipping-info';

export class CallMetadataDto {
  @IsString()
  DID: string;

  @IsString()
  @Optional()
  callerId?: string;

  @IsString()
  @Optional()
  callerPhone?: string;

  @IsString()
  @Optional()
  callerName?: string;

  @IsString()
  sessionId: string;

  @Optional()
  invoiceId?: string;

  @Optional()
  invoices?: Map<string, Invoice>;

  @Optional()
  messages?: string[];

  @Optional()
  rachelId?: string[];

  @Optional()
  rachelTenantId?: string[];

  @Optional()
  shippingInfo?: ShippingInfo;

  @Optional()
  @IsBoolean()
  needsShippingInfo?: boolean;
}
