import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Invoice } from '../interfaces/invoice';
import { OrderItem } from '../interfaces/order-item';
import { v4 as uuidv4 } from 'uuid';
import { Product } from '../interfaces/product';

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);
  private invoices: Map<string, Invoice> = new Map();

  constructor(private readonly configService: ConfigService) {}

  createInvoice(
    customerId: string,
    customerName: string,
    customerPhone: string,
    items: (null | { unitPrice: number; product: Product; quantity: any })[],
    notes?: string,
  ): Invoice {
    const filteredItems = items.filter(
      (item): item is { unitPrice: number; product: Product; quantity: any } =>
        item !== null,
    );

    const total = filteredItems.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0,
    );

    const invoice: Invoice = {
      id: uuidv4(),
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

    return invoice;
  }

  getInvoice(id: string): Invoice | undefined {
    return this.invoices.get(id);
  }

  updateInvoice(id: string, updates: Partial<Invoice>): Invoice | undefined {
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
    return updatedInvoice;
  }

  generateReceiptNumber(invoiceId: string): string {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) {
      throw new Error(`Invoice ${invoiceId} not found`);
    }

    // Generate a receipt number based on date and invoice ID
    const date = new Date();
    const timestamp = (
      date.getFullYear() +
      date.getMonth() +
      date.getDate() +
      date.getHours() +
      date.getMinutes() +
      date.getSeconds()
    ).toString();

    const receiptNumber = `RMS-${timestamp}`;

    // Update the invoice with the receipt number
    invoice.receiptNumber = receiptNumber;
    this.invoices.set(invoiceId, invoice);

    return receiptNumber;
  }
}
