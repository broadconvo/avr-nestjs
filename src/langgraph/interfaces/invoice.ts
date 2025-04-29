import { OrderItem } from './order-item';

export interface Invoice {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  items: OrderItem[] | null;
  total: number;
  createdAt: Date;
  status: 'draft' | 'pending' | 'paid' | 'cancelled';
  notes?: string;
  receiptNumber?: string;
}
