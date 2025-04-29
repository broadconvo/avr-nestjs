interface ConversationRequest {
  message: string;
  context?: {
    callerId?: string;
    contactName?: string;
    contactPhone?: string;
    from?: string;
    [key: string]: any;
  };
}
