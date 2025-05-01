import { z } from 'zod';
import { CallMetadataDto } from '../../audio/dto/call-metadata.dto';

// Conversation States
export type ConversationState =
  | 'greeting'
  | 'company_inquiry'
  | 'understanding_problem'
  | 'product_identification'
  | 'invoice_creation'
  | 'invoice_update'
  | 'providing_solution'
  | 'farewell';

// Product Types
export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
}

export interface SelectedProduct {
  productId: string;
  productName: string;
  quantity: number;
  price: string;
}

// State Types
export interface GraphState {
  query?: string;
  messages: string[];
  context: CallMetadataDto;
  currentResponse: string;
  conversationState: ConversationState;
  selectedProducts: SelectedProduct[];
  invoiceId?: string;
  history?: string;
}

// Parser Schemas
export const stateOutputSchema = z.object({
  nextState: z.enum([
    'greeting',
    'company_inquiry',
    'understanding_problem',
    'product_identification',
    'invoice_creation',
    'invoice_update',
    'providing_solution',
    'farewell',
  ]),
  reasoning: z.string(),
});

export const productOutputSchema = z.object({
  products: z.array(
    z.object({
      productId: z.string(),
      productName: z.string(),
      quantity: z.number().default(1),
      price: z.string(),
    }),
  ),
  needsMoreInfo: z.boolean(),
});

export type StateOutput = z.infer<typeof stateOutputSchema>;
export type ProductOutput = z.infer<typeof productOutputSchema>;

// Node Return Types
export interface DetermineStateReturn {
  conversationState: ConversationState;
}

export interface IdentifyProductsReturn {
  selectedProducts: SelectedProduct[];
}

export interface CreateInvoiceReturn {
  invoiceId: string;
  context: {
    invoiceTotal: number;
    invoiceDetails: Record<string, any>;
  };
}

export interface GenerateResponseReturn {
  currentResponse: string;
}
