import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ContactResponseDto } from '../dto/contact-lookup.dto';

@Injectable()
export class ContactLookupService {
  private readonly logger = new Logger(ContactLookupService.name);
  private readonly tokenUrl: string | undefined;
  private readonly contactUrlTemplate: string | undefined;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.tokenUrl = this.configService.get<string>('CRM_TOKEN_URL');
    this.contactUrlTemplate = this.configService.get<string>(
      'CRM_CONTACT_URL_TEMPLATE',
    );
    this.clientId = this.configService.get<string>('CRM_CLIENT_ID');
    this.clientSecret = this.configService.get<string>('CRM_CLIENT_SECRET');
  }

  async lookupContact(callerId: string): Promise<ContactResponseDto> {
    // Check if callerId is provided
    if (!callerId) {
      this.logger.error('Caller ID is required but was not provided');
      return this.getEmptyResponse();
    }

    // Check if required configuration is available
    if (
      !this.tokenUrl ||
      !this.contactUrlTemplate ||
      !this.clientId ||
      !this.clientSecret
    ) {
      this.logger.error('Missing required configuration for contact lookup');
      return this.getEmptyResponse();
    }

    try {
      // Step 1: Get Bearer Token
      const startTime = Date.now();
      const tokenResponse = await axios.post(
        this.tokenUrl,
        {
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret,
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
      const contactUrl = this.contactUrlTemplate.replace(
        /{callerId}/g,
        callerId,
      );
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
      contactFirstname: '',
      contactName: '',
      contactPhone: '',
      apiDuration,
    };
  }
}
