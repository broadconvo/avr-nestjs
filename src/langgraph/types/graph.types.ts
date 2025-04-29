import { z } from 'zod';

// Conversation States
export type ConversationState =
  | 'greeting'
  | 'understanding_problem'
  | 'product_identification'
  | 'invoice_creation'
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

export interface IdentifiedProduct {
  productName: string;
  quantity: number;
  confidence: number;
}

// State Types
export interface GraphState {
  messages: string[];
  context: Record<string, any>;
  currentResponse: string;
  conversationState: ConversationState;
  identifiedProducts: IdentifiedProduct[];
  invoiceId?: string;
}

// Parser Schemas
export const stateOutputSchema = z.object({
  nextState: z.enum([
    'greeting',
    'understanding_problem',
    'product_identification',
    'invoice_creation',
    'providing_solution',
    'farewell',
  ]),
  reasoning: z.string(),
});

export const productOutputSchema = z.object({
  products: z.array(
    z.object({
      productName: z.string(),
      quantity: z.number().default(1),
      confidence: z.number().min(0).max(1),
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
  identifiedProducts: IdentifiedProduct[];
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
