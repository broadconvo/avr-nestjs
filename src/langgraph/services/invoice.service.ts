import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Invoice } from '../interfaces/invoice';
import { v4 as uuidv4 } from 'uuid';
import { Product } from '../interfaces/product';
import axios from 'axios';

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);
  private invoices: Map<string, Invoice> = new Map();
  private readonly crmTokenUrl: string | undefined;
  private readonly crmModuleUrl: string | undefined;
  private readonly crmInvoiceWorkflow: string | undefined;
  private readonly crmClientId: string | undefined;
  private readonly crmClientSecret: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.crmTokenUrl = this.configService.get<string>('CRM_TOKEN_URL');
    this.crmModuleUrl = this.configService.get<string>('CRM_MODULE_URL');
    this.crmClientId = this.configService.get<string>('CRM_CLIENT_ID');
    this.crmClientSecret = this.configService.get<string>('CRM_CLIENT_SECRET');
    this.crmInvoiceWorkflow = this.configService.get<string>(
      'CRM_INVOICE_WORKFLOW',
    );
  }

  async createInvoice(
    customerId: string,
    customerName: string,
    customerPhone: string,
    items: (null | { unitPrice: number; product: Product; quantity: any })[],
    notes?: string,
  ): Promise<{ invoices: Map<string, Invoice>; invoice: Invoice } | null> {
    // Check if required configuration is available
    if (
      !this.crmTokenUrl ||
      !this.crmModuleUrl ||
      !this.crmInvoiceWorkflow ||
      !this.crmClientSecret ||
      !this.crmClientId
    ) {
      this.logger.error('Missing required configuration for contact lookup');
      return null;
    }

    try {
      // Step 1: Get Bearer Token
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
      }

      this.logger.log('Token retrieved successfully');

      // Step 2: Create Invoice
      const filteredItems = items.filter(
        (
          item,
        ): item is { unitPrice: number; product: Product; quantity: any } =>
          item !== null,
      );

      const total = filteredItems.reduce(
        (sum, item) => sum + item.quantity * item.unitPrice,
        0,
      );

      this.logger.log('Items were gathered and total calculated');

      // Step 2: Create invoice in CRM
      const headers = {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        httpsAgent: new (await import('https')).Agent({
          rejectUnauthorized: false,
        }),
      };
      const sixCharUuidV4 = uuidv4().replace(/-/g, '').slice(0, 6);
      const invoiceData = {
        data: {
          type: 'AOS_Invoices',
          attributes: {
            name: `Invoice for ${customerName} - ${sixCharUuidV4}`,
            billing_contact_id: customerId,
            status: 'Unpaid',
            rms_order_placed_by_telno_c: customerPhone,
            rms_order_placed_by_c: customerName,
            date_entered: '2025-05-01',
            total_amt: total.toFixed(2),
            custom_invoice_prefix_c: 'N',
            bugs_aos_invoices_1bugs_ida: this.crmInvoiceWorkflow,
            currency_id: '-99',
          },
        },
      };

      this.logger.log(
        `Creating invoice in CRM with data: ${JSON.stringify(invoiceData)}`,
      );
      const invoiceResponse = await axios.post(
        this.crmModuleUrl,
        invoiceData,
        headers,
      );
      const invoiceReceipt =
        invoiceResponse.data.data.attributes.bg_invoice_num_c;
      const invoiceId = invoiceResponse.data.data.id;
      this.logger.log(`Invoice ID created in CRM`);

      const invoice: Invoice = {
        id: invoiceId,
        receiptNumber: invoiceReceipt,
        customerId,
        customerName,
        customerPhone,
        items: filteredItems,
        total,
        createdAt: new Date(),
        status: 'draft',
        notes,
      };

      this.invoices.set(invoice.id, invoice);
      this.logger.log(
        `Created invoice ${invoice.id} for customer ${customerName}`,
      );
      return {
        invoices: this.invoices,
        invoice,
      };
    } catch (error) {
      this.logger.error(
        `Error in creating invoice in CRM: ${error.message}`,
        error.stack,
      );
      return null;
    } // end create crm invoice
  }

  getInvoice(id: string): Invoice | undefined {
    console.log(this.invoices);
    return this.invoices.get(id);
  }

  updateInvoice(
    id: string,
    updates: Partial<Invoice>,
  ): { invoices: Map<string, Invoice>; invoice: Invoice } | undefined {
    const invoice = this.invoices.get(id);
    if (!invoice) {
      return undefined;
    }

    const updatedInvoice = { ...invoice, ...updates };

    // Recalculate total if items were updated
    if (updatedInvoice.items) {
      updatedInvoice.total = updatedInvoice.items.reduce(
        (sum, item) => sum + item.quantity * item.unitPrice,
        0,
      );
    } else {
      updatedInvoice.total = 0;
    }

    this.invoices.set(id, updatedInvoice);
    return { invoices: this.invoices, invoice: updatedInvoice };
  }

  async addProductsToInvoice(id: string, invoice: Partial<Invoice>) {
    // Check if required configuration is available
    if (
      !this.crmTokenUrl ||
      !this.crmModuleUrl ||
      !this.crmInvoiceWorkflow ||
      !this.crmClientSecret ||
      !this.crmClientId
    ) {
      this.logger.error('Missing required configuration for contact lookup');
      return;
    }

    try {
      // Step 1: Get Bearer Token
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
      }

      this.logger.log('Token retrieved successfully');

      // Step 2: Create invoice in CRM
      const headers = {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        httpsAgent: new (await import('https')).Agent({
          rejectUnauthorized: false,
        }),
      };

      const promises: any[] = [];
      let productCount: number = 0;
      invoice.items?.forEach((item) => {
        const productData = {
          data: {
            type: 'AOS_Products_Quotes',
            attributes: {
              parent_id: invoice.id,
              product_id: item.product.id,
              name: item.product.name,
              item_description: item.product.description,
              part_number: item.product.sku,
              product_qty: item.quantity.toString(),
              product_unit_price: item.unitPrice.toString(),
              product_total_price: (item.unitPrice * item.quantity).toString(),
              product_list_price: item.product.price.toString(),
              number: (++productCount).toString(),
              // default
              parent_type: 'AOS_Invoices',
              product_cost_price: '0.00',
              vat_amt: '0.00',
              vat: '',
              currency_id: '-9',
            },
          },
        };

        this.logger.log(`Adding Products to Invoice: ${invoice.receiptNumber}`);
        if (this.crmModuleUrl != null) {
          promises.push(axios.post(this.crmModuleUrl, productData, headers));
        }
      });

      await Promise.all(promises);

      this.logger.log(
        `Added ${invoice.items?.length} products to invoice ${invoice.receiptNumber}`,
      );
    } catch (error) {
      this.logger.error(
        `Error in adding products to an invoice in CRM: ${error.message}`,
        error.stack,
      );
    } // end create crm invoice
  }
}
