interface ConversationState {
  messages: string[];
  context: Record<string, any>;
  currentResponse: string;
  conversationState:
    | 'greeting'
    | 'understanding_problem'
    | 'product_identification'
    | 'invoice_creation'
    | 'invoice_update'
    | 'providing_solution'
    | 'farewell';
  identifiedProducts: Array<{
    productId: string;
    quantity: number;
    confidence: number;
  }>;
  invoiceId?: string;
}
