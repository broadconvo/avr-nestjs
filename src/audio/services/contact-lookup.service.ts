import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ContactResponseDto } from '../dto/contact-lookup.dto';

@Injectable()
export class ContactLookupService {
  private readonly logger = new Logger(ContactLookupService.name);
  private readonly crmTokenUrl: string | undefined;
  private readonly crmContactUrl: string | undefined;
  private readonly crmClientId: string | undefined;
  private readonly crmClientSecret: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.crmTokenUrl = this.configService.get<string>('CRM_TOKEN_URL');
    this.crmContactUrl = this.configService.get<string>('CRM_CONTACT_URL');
    this.crmClientId = this.configService.get<string>('CRM_CLIENT_ID');
    this.crmClientSecret = this.configService.get<string>('CRM_CLIENT_SECRET');
  }

  async lookupContact(callerId: string): Promise<ContactResponseDto> {
    // Check if callerId is provided
    if (!callerId) {
      this.logger.error('Caller ID is required but was not provided');
      return this.getEmptyResponse();
    }

    // Check if required configuration is available
    if (
      !this.crmTokenUrl ||
      !this.crmContactUrl ||
      !this.crmClientId ||
      !this.crmClientSecret
    ) {
      this.logger.error('Missing required configuration for contact lookup');
      return this.getEmptyResponse();
    }

    try {
      // Step 1: Get Bearer Token
      const startTime = Date.now();
      const tokenResponse = await axios.post(
        this.crmTokenUrl,
        {
          grant_type: 'client_credentials',
          client_id: this.crmClientId,
          client_secret: this.crmClientSecret,
        },
        {
          httpsAgent: new (await import('https')).Agent({
            rejectUnauthorized: false,
          }),
        },
      );

      const token = tokenResponse.data.access_token;
      if (!token) {
        this.logger.error('Failed to retrieve token');
        return this.getEmptyResponse();
      }

      // Step 2: Call Contact API
      const contactUrl = this.crmContactUrl.replace(/{callerId}/g, callerId);
      const contactResponse = await axios.get(contactUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        httpsAgent: new (await import('https')).Agent({
          rejectUnauthorized: false,
        }),
      });

      const endTime = Date.now();
      const apiDuration = `${((endTime - startTime) / 1000).toFixed(2)}s`;

      const data = contactResponse.data.data || [];
      if (!data.length) {
        return this.getEmptyResponse(apiDuration);
      }

      const attributes = data[0].attributes || {};
      const id = data[0].id || '';
      const fullName = attributes.full_name || '';
      const firstname = attributes.first_name || '';
      const phoneMobile = attributes.phone_mobile || '';
      const phoneWork = attributes.phone_work || '';

      // Determine which phone number matches callerId
      const contactPhone =
        phoneWork === callerId
          ? phoneWork
          : phoneMobile === callerId
            ? phoneMobile
            : '';

      return {
        contactId: id,
        contactFirstname: firstname,
        contactName: fullName,
        contactPhone,
        apiDuration,
      };
    } catch (error) {
      this.logger.error(
        `Error in contact lookup: ${error.message}`,
        error.stack,
      );
      return this.getEmptyResponse();
    }
  }

  private getEmptyResponse(apiDuration: string = '0'): ContactResponseDto {
    return {
      contactId: '',
      contactFirstname: '',
      contactName: '',
      contactPhone: '',
      apiDuration,
    };
  }
}
