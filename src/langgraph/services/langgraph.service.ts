import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { StateGraph } from '@langchain/langgraph';
import { RunnableSequence } from '@langchain/core/runnables';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import {
  StringOutputParser,
  StructuredOutputParser,
} from '@langchain/core/output_parsers';
import { z } from 'zod';
import { ProductService } from './product.service';
import { InvoiceService } from './invoice.service';
import { GraphState } from '../types/graph.types';
import { OrderItem } from '../interfaces/order-item';
import { CallMetadataDto } from '../../audio/dto/call-metadata.dto';
import axios from 'axios';

@Injectable()
export class LangGraphService implements OnModuleInit {
  private readonly logger = new Logger(LangGraphService.name);
  private model: ChatOpenAI;
  private graph: any;
  private readonly rachelUrl: string | undefined;
  private readonly rachelLanguage: string | undefined;

  constructor(
    private readonly configService: ConfigService,
    private readonly productService: ProductService,
    private readonly invoiceService: InvoiceService,
  ) {
    this.rachelUrl = this.configService.get<string>('RACHEL_URL');
    this.rachelLanguage = this.configService.get<string>('RACHEL_LANGUAGE');
  }

  onModuleInit() {
    const openAiModel = this.configService.get<string>(
      'OPENAI_MODEL_NAME',
      'gpt-4',
    );
    // Initialize the LLM
    this.model = new ChatOpenAI({
      openAIApiKey: this.configService.get<string>('OPENAI_API_KEY'),
      model: openAiModel,
      temperature: 0, // Lower temperature for more deterministic outputs
    });

    // Create the graph
    this.initializeGraph().then(() => {
      this.logger.log('Graph initialized successfully');
    });

    this.logger.log(`LangGraph service initialized using ${openAiModel}`);
  }

  private async initializeGraph() {
    /**
     * ----------------------------------------------------------------
     * Prompts - Used by the graph to determine the current state of conversation
     * ----------------------------------------------------------------
     * Analyze Message State: Analyzes the message and determines the next state.
     * Generate Response State: Generates a response based on the current state.
     */
    // Define output parsers
    const analyzeOutputParser = StructuredOutputParser.fromZodSchema(
      z.object({
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
        products: z.array(
          z.object({
            productId: z.string(),
            productName: z.string(),
            quantity: z.number().default(1),
            price: z.number().default(1),
          }),
        ),
        needsMoreInfo: z.boolean(),
        shippingInfo: z
          .object({
            addressDetected: z.boolean().default(false),
            possibleAddress: z.string().default(''),
            dateDetected: z.boolean().default(false),
            possibleDate: z.string().default(''),
          })
          .optional(),
      }),
    );

    // Get all products for reference
    const allProducts = await this.productService.getAllProducts();
    const productCatalog = allProducts
      .map(
        (p) =>
          `- ID: ${p.id}, Name: ${p.name}, Description: ${p.description}, Price: ${p.price}, Category: ${p.category}`,
      )
      .join('\n');

    const analyzeMessagePromptTemplate =
      ChatPromptTemplate.fromTemplate(`You are a customer service assistant for a milk company. 
  Your role is to analyze the latest user message within the context of 
  the conversation history and current state to determine the most 
  appropriate next state and identify any products mentioned from 
  the provided catalog. Additionally, handle queries about available 
  products by listing all items in the catalog when appropriate. 
  Follow these instructions carefully:
      
  ** Product Catalog: **
  ${productCatalog}

  ** Inputs: ** 
  - ** Conversation history: ** {history} (A summary or log of previous messages in the conversation)
  - ** Latest User Message: ** {message} (The most recent message from the user)
  - ** Current State: ** {currentState} (The current stage of the conversation, e.g., greeting, understanding_problem)
  - ** Context: ** {context} (Contains information about the conversation, including shipping details if available)

  **Task:**
  1. **Determine the Next State:** Based on the latest user message and conversation context, select the most appropriate next state from the following:
     - greeting: Initial interaction or welcoming the user
     - company_inquiry: If the question is not related to products in the catalog, it might be a question about the company so still transition to company_inquiry. 
        User asks about the company or its services, this includes the knowledge base of the company.
     - understanding_problem: Clarifying or gathering details about the user's issue or query
     - product_identification: Identifying and confirming products mentioned by the user. Providing a list of all products in the catalog (e.g., when asked "What products do you have?")
     - invoice_creation: ONLY transition to this state when products are confirmed AND complete shipping information (address and date) is provided
     - invoice_update: Updating or modifying an existing invoice
     - providing_solution: Offering a solution or answering the user's query
     - farewell: Concluding the conversation
  
  2. **Handle Product Queries:**
     - If the user asks about available products (e.g., "What products do you have?" or "What do you sell?"):
       - Transition to the "product_identification" state.
       - List all products in the catalog with their ID, Name, Description, and Price.
       - Do not include quantities unless specified by the user.
     - If specific products are mentioned in the latest user message or conversation history:
       - Transition to the "product_identification" state.
       - List each mentioned product with its ID, Name, Quantity (if specified, default to 1 if not), and Price.
       - If a product is referenced ambiguously (e.g., "formula for babies"), match it to the most relevant 
          product based on the description or category and explain the assumption.
     - If no products are mentioned and the query is not about available products, return an empty product list.
     - Stick with the price from the catalog.
  
  3. **Detect Shipping Information:**
     - If the user message contains what appears to be a shipping address, set addressDetected to true and extract the possible address.
     - If the user message mentions a specific date for delivery, set dateDetected to true and extract the possible date.
     - If the user is confirming or discussing payment methods, note this in the reasoning.
     - Check if shipping information is complete before allowing transition to invoice_creation.
  
  4. **Handle Edge Cases:**
     - IMPORTANT: Even if products are selected and confirmed, DO NOT transition to "invoice_creation" state if shipping information (address and date) is incomplete.
     - If products are selected but shipping information is missing, stay in "product_identification" state or transition to "understanding_problem" to gather shipping details.
     - If the user message is unclear or off-topic, transition to the "understanding_problem" state to seek clarification.
     - If the user requests to end the conversation, transition to the "farewell" state.
     - If the current state is invalid (not one of the defined states), default to "greeting".
     - Ensure responses only reference products in the provided catalog, not generic or unlisted products.

  5. **Shipping Information Verification:**
     - Before transitioning to "invoice_creation", verify that:
       a) At least one product has been selected and confirmed
       b) A complete shipping address has been provided
       c) A delivery date has been specified or agreed upon
     - If any of these elements are missing, remain in the current state or transition to "understanding_problem" to gather the missing information.

  **Output Format:** {format_instructions}`);
    const analyzeMessagePrompt = RunnableSequence.from([
      analyzeMessagePromptTemplate,
      this.model,
      analyzeOutputParser,
    ]);

    const generateResponsePromptTemplate = ChatPromptTemplate.fromTemplate(
      `You are a professional customer service assistant for a company that sells milk and related products for RMS (Retail Milk Solutions). 
  Your goal is to provide accurate and concise responses tailored to the user's needs. Follow these instructions carefully.
  Make sure that the total prices for the user's selected products are correct.

  Prompt Instructions:
  
  Generate a response based on the provided conversation state and context.
  Use a friendly and professional tone suitable for customer service.
  Ensure the response aligns with the current state of the conversation and addresses the latest user message.
  If selectedProducts are provided, acknowledge the products, clearly state the selected products, and confirm which product the user wants if there are multiple product suggestions.
  If no specific products were provided, ask clarifying questions to understand the user's needs or provide general information about available products from the catalog.
  If invoiceInfo is provided, include the receipt number and total amount, and confirm the invoice details with the user.
  
  IMPORTANT: For invoice creation and updates:
  - If an invoice is being created or updated, ask for the shipping address if not already provided.
  - If the shipping address is provided but shipping date is not, suggest a delivery date within the next 3-5 business days.
  - Always confirm the total amount and payment method with the customer.
  - After confirming all details (products, shipping address, date, and payment), provide the receipt number immediately and confirm the order is complete.
  - DO NOT tell the user that their order "is being processed" or that you will "notify them shortly" - the process is immediate.
  - When the invoice is created, immediately provide the receipt number in your response.
  
  If any required information (e.g., history, currentState, context, selectedProducts, invoiceInfo) is missing or unclear, politely request clarification from the user to proceed effectively.
  Avoid making assumptions about unavailable data, such as product prices or invoice details, unless explicitly provided.
  Do not generate responses longer than necessary, but ensure they are complete and actionable.
  
  ** Input Parameters: **
  ** Conversation history: ** {history}
  ** Latest user message: ** {message}
  ** Current state: {currentState} (e.g., inquiry, product selection, order confirmation, invoice generated)
  ** Context: ** {context} (e.g., user is inquiring about milk types, placing an order, or requesting invoice details)
  ** Selected Products: ** {selectedProducts} (e.g., 1x Infant Milk - $299.99) This is what the user has selected from the catalog
  ** Product Catalog: ** {productCatalog} (e.g., list of available milk products with prices)
  ** Invoice Information: ** {invoiceInfo}
  
  ** Response Guidelines: **
  - Acknowledge the user's latest message and reference relevant details from the conversation history or context.
  - When updating the invoice, make sure that the total price is updated based on the selected products.
  - For product-related inquiries without specific selections, highlight available milk products from the catalog.
  - If products are selected, confirm the selection and provide a clear breakdown of the total amount (e.g., "You've selected 2 units of Whole Milk at $3.50 each and 1 unit of Skim Milk at $3.00, for a total of $10.00").
  - If the user confirms an order and all necessary information is available, create or update the invoice immediately.
  - If an invoice exists but shipping information is incomplete, ask for the missing details (address, date).
  - When all invoice details are complete, provide a professional summary with the receipt number (e.g., "Your order has been completed. Your receipt number is RMS12345. Your order total is $10.50 and will be delivered to [address] on [date]. Thank you for your order.").
  - If the conversation state is unclear, ask targeted questions (e.g., "Could you clarify which type of milk you're interested in, such as whole, skim, or organic?").
  
  IMPORTANT: The order processing is immediate - never suggest that the order is "being processed" or that you will "get back to the customer later" with information. All information should be provided in your immediate response.
  
  Text-to-Speech Optimization:
  - Write responses in clear, simple, and conversational English to ensure natural TTS output.
  - Avoid special characters (e.g., #, *, &, %, @) in words or numbers to prevent mispronunciation.
  - Use numerals for numbers (e.g., "2 liters" instead of "two liters") for consistent TTS rendering.
  - Avoid abbreviations (e.g., use "liters" instead of "L") unless they are widely understood and pronounceable.
  - Ensure proper punctuation (e.g., periods, commas) to guide TTS pausing and intonation.
  - Avoid jargon, emojis, or symbols that could result in "garbage words" when spoken.
  - Avoid line breaks or paragraphs in the response to ensure a smooth TTS experience.
  
  ** Example Scenarios: **
  No Selected Products: User asks, "What milk do you have?" → Respond with a list of available milk types and ask for their preference.
  Selected Products: User selects 2 whole milk and 1 skim milk → Confirm the selection, list products, and provide the total amount.
  Invoice Generated: Invoice exists → Provide receipt number, total, and ask if the user needs further assistance.
  Incomplete Invoice: Invoice exists but missing shipping address → Ask for the shipping address to complete the order.
  Complete Invoice: All details provided → transition to invoice_creation and Confirm the order with receipt number and delivery details immediately: "Your order is complete. Your receipt number is RMS12345. Your order will be delivered to [address] on [date]. Thank you for your order."
  `,
    );

    // 3. Generate response based on state
    const generateResponsePrompt = RunnableSequence.from([
      generateResponsePromptTemplate,
      this.model,
      new StringOutputParser(),
    ]);

    /**
     * ----------------------------------------------------------------
     * Nodes - Used by the graph to define the actions taken at each state
     * ----------------------------------------------------------------
     * Analyze Message Node: Analyzes the message and determines the next state.
     * Identify Products Node: Identifies products mentioned in the message.
     * Create Invoice Node: Creates an invoice based on identified products.
     */

    const analyzeMessageNode = async (state: GraphState) => {
      const history = state.messages.join('\n');
      const lastMessage = state.messages[state.messages.length - 1];

      const analysisResult = await analyzeMessagePrompt.invoke({
        history,
        message: lastMessage,
        context: JSON.stringify(state.context),
        currentState: state.conversationState,
        format_instructions: analyzeOutputParser.getFormatInstructions(),
      });

      console.log('analyzeMessageNode', {
        reasoning: analysisResult.reasoning,
      });
      // Map identified product names to actual product IDs
      const selectedProducts = (analysisResult.products || [])
        .map((p) => {
          const matchedProducts = this.productService.searchProducts(
            p.productName,
          );
          if (matchedProducts.length > 0) {
            return {
              productId: matchedProducts[0].id,
              productName: matchedProducts[0].name,
              quantity: p.quantity,
              price: p.price,
            };
          }
          return null;
        })
        .filter((p) => p !== null);

      // Update shipping information if detected
      if (analysisResult.shippingInfo) {
        if (!state.context.shippingInfo) {
          state.context.shippingInfo = {
            address: '',
            date: '',
            paymentMethod: 'Cash Only',
          };
        }

        if (
          analysisResult.shippingInfo.addressDetected &&
          analysisResult.shippingInfo.possibleAddress
        ) {
          state.context.shippingInfo.address =
            analysisResult.shippingInfo.possibleAddress;
        }

        if (
          analysisResult.shippingInfo.dateDetected &&
          analysisResult.shippingInfo.possibleDate
        ) {
          state.context.shippingInfo.date =
            analysisResult.shippingInfo.possibleDate;
        }
      }

      // Override invoice_creation state if shipping info is incomplete
      if (analysisResult.nextState === 'invoice_creation') {
        const hasCompleteShippingInfo =
          state.context.shippingInfo &&
          state.context.shippingInfo.address &&
          state.context.shippingInfo.date;

        if (!hasCompleteShippingInfo) {
          // If shipping info is incomplete, stay in product_identification or understanding_problem
          analysisResult.nextState =
            selectedProducts.length > 0
              ? 'product_identification'
              : 'understanding_problem';

          console.log(
            'Preventing transition to invoice_creation due to incomplete shipping info',
          );
        }
      }

      return {
        conversationState: analysisResult.nextState,
        selectedProducts: selectedProducts,
        invoiceId: state.context.invoiceId,
        context: state.context,
      };
    };

    const companyInquiryNode = async (state: GraphState) => {
      this.logger.log('Inquiring about the company...');

      this.logger.log(
        `[${state.context.sessionId}] Sending to Rachel: ${state.query}`,
      );

      // Create a new thread
      let response: string = '';
      if (this.rachelUrl != null) {
        await axios
          .post(this.rachelUrl, {
            message: state.query,
            language: this.rachelLanguage,
            uniqueId: state.context.sessionId, // from pbx - search CDR
            // customer service agent or receptionist
            rachelId: state.context.rachelId,
            tenantId: state.context.rachelTenantId,
          })
          .then((res) => {
            response = res.data.response;
          })
          .catch((err) => {
            console.error(err.response.data.error);
          });
      }
      return {
        currentResponse: response,
      };
    };

    const createInvoiceNode = async (state: GraphState) => {
      this.logger.log('Creating invoice...');

      // Get customer info from context
      const customerId = state.context.callerId || 'unknown';
      const customerName = state.context.callerName || 'Unknown Customer';
      const customerPhone = state.context.callerPhone || '';

      // Create order items
      const orderItems = state.selectedProducts.map((p) => {
        const product = this.productService.getProductById(p.productId);
        if (!product) {
          this.logger.warn(`Product with ID ${p.productId} not found.`);
          return null; // Skip if product is undefined
        }
        return {
          product,
          quantity: p.quantity,
          unitPrice: product.price,
        };
      });

      // Get shipping information from context if available
      const shippingInfo = state.context.shippingInfo || {
        address: '',
        date: '',
        paymentMethod: 'Cash Only', // Default payment method
      };

      // Create the invoice
      const createInvoiceResult = await this.invoiceService.createInvoice(
        customerId,
        customerName,
        customerPhone,
        orderItems,
        `Created from conversation on ${new Date().toISOString()}`,
        shippingInfo,
      );

      if (!createInvoiceResult) {
        this.logger.error('No invoice was created.');
        return {
          currentResponse: 'Sorry, I could not create the invoice.',
        };
      }

      this.logger.log(
        `Created invoice ${createInvoiceResult.invoice.id} with receipt number ${createInvoiceResult.invoice.receiptNumber}`,
      );

      state.context.invoices = createInvoiceResult.invoices; // Store the invoices in context
      state.context.invoiceId = createInvoiceResult.invoice.id; // Store the invoice ID in context
      return { context: state.context }; // Return the invoice ID
    };

    const updateInvoiceNode = (state: GraphState) => {
      this.logger.log('Updating invoice...');

      // 1. Get the invoice ID from the state
      // Assumes the invoiceId is stored directly in the state channel.
      // If it's stored in context, use state.context.invoiceId
      const invoiceId = state.context.invoiceId;

      if (!invoiceId) {
        this.logger.error(
          'Cannot update invoice: No invoice ID found in state.',
        );
        // Return an empty object or specific error state if your graph handles it
        return {
          currentResponse: 'Sorry, I could not find an invoice to update.',
        };
      }

      // 2. Check if there are products to update with (as per conditional edge logic)
      if (!state.selectedProducts || state.selectedProducts.length === 0) {
        this.logger.warn(
          `Attempted to update invoice ${invoiceId} but no products were selected in the current state transition.`,
        );
        // This might indicate a logic error in the graph flow or state management
        return {
          currentResponse:
            'It seems no products were selected to update the invoice with.',
        };
      }

      // 3. Prepare the updated items based on selectedProducts from the state
      const updatedOrderItems = state.selectedProducts
        .map((p) => {
          const product = this.productService.getProductById(p.productId);
          if (!product) {
            this.logger.warn(
              `Product with ID ${p.productId} not found during invoice update for invoice ${invoiceId}. Skipping item.`,
            );
            return null; // Skip if product is not found
          }
          // Use the canonical price from the product service, not potentially stale price from state
          return {
            product,
            quantity: p.quantity,
            unitPrice: product.price,
          };
        })
        // Filter out nulls and ensure type correctness
        .filter((item): item is OrderItem => item !== null);

      // 4. Call the updateInvoice service method
      const updatedInvoiceResult = this.invoiceService.updateInvoice(
        invoiceId,
        {
          items: updatedOrderItems, // Update the items list
          // You could potentially update other fields like 'notes' if captured in the state
          // notes: state.context?.updateNotes || invoice.notes // Example
        },
      );

      // 5. Handle the result
      if (!updatedInvoiceResult) {
        this.logger.error(
          `Failed to update invoice with ID: ${invoiceId}. Invoice not found or update failed.`,
        );
        // Clear the invoiceId in state if the update failed because it wasn't found?
        return {
          invoiceId: undefined,
          currentResponse: `Sorry, I couldn't find or update the invoice with ID ${invoiceId}.`,
        };
      }

      state.context.invoices = updatedInvoiceResult.invoices; // Update the context with the new invoice
      this.logger.log(
        `Successfully updated invoice ${updatedInvoiceResult.invoice.id}. New total: ${updatedInvoiceResult.invoice.total}`,
      );

      // 6. Return the invoice ID (it shouldn't change, but returning confirms it)
      // The reducer for invoiceId just replaces the value, so this keeps it consistent.
      // We don't need to return currentResponse here as generate_response node handles that.
      return { context: state.context };
    };

    const generateResponseNode = async (state: GraphState) => {
      this.logger.log('Generating response...', state);
      const history = state.messages.join('\n');
      const lastMessage = state.messages[state.messages.length - 1];

      // Get invoice information if available
      let invoiceInfo = 'No invoice created yet.';
      if (state.context.invoiceId) {
        const invoice = this.invoiceService.getInvoice(state.context.invoiceId);
        // <YYYY-MM-DD>
        if (invoice) {
          // Get shipping info from context or invoice
          const shippingInfo = state.context.shippingInfo ||
            invoice.shippingInfo || {
              address: '',
              date: '',
              paymentMethod: 'Cash Only',
            };

          // Format shipping date if available
          const shippingDate = shippingInfo.date
            ? new Date(shippingInfo.date).toLocaleDateString()
            : '';

          invoiceInfo = `
            Invoice ID: ${invoice.id}
            Shipping Address: ${shippingInfo.address || 'Not provided yet'}
            Shipping Date: ${shippingDate || 'Not scheduled yet'}
            Payment Method: ${shippingInfo.paymentMethod || 'Cash Only'}
            Receipt Number: ${invoice.receiptNumber}
            Customer: ${invoice.customerName}
            Items: ${invoice.items!.map((item) => `${item.quantity}x ${item.product.name} @ ${item.unitPrice}`).join(', ')}
            Total: ${invoice.total.toFixed(2)}
          `;
        }
      }

      // Format selected products for the prompt
      const selectedProductsText =
        state.selectedProducts.length > 0
          ? state.selectedProducts
              .map((p) => {
                const product = this.productService.getProductById(p.productId);
                return `${p.quantity}x ${product!.name} @ ${p.price}`;
              })
              .join('\n')
          : 'No products selected yet.';

      console.log('Invoke generateResponseNode - ', {
        history,
        message: lastMessage,
        currentState: state.conversationState,
        context: JSON.stringify(state.context),
        selectedProducts: selectedProductsText,
        productCatalog: productCatalog,
        invoiceInfo,
      });
      const response = await generateResponsePrompt.invoke({
        history,
        message: lastMessage,
        currentState: state.conversationState,
        context: JSON.stringify(state.context),
        selectedProducts: selectedProductsText,
        productCatalog: productCatalog,
        invoiceInfo,
      });

      // Check if we need to update shipping information based on the response
      // This is a simple heuristic - you might want to use a more sophisticated approach
      if (
        response.toLowerCase().includes('shipping address') ||
        response.toLowerCase().includes('delivery address')
      ) {
        // Mark that we need shipping information in the context
        state.context.needsShippingInfo = true;
      }

      // Extract shipping address from user message if provided
      if (
        state.context.needsShippingInfo &&
        lastMessage.toLowerCase().includes('address') &&
        lastMessage.length > 20
      ) {
        // Simple heuristic to detect an address
        if (!state.context.shippingInfo) {
          state.context.shippingInfo = {
            address: '',
            date: '',
            paymentMethod: 'Cash Only',
          };
        }
        state.context.shippingInfo.address = lastMessage;

        // If we have an address but no date, set a default shipping date (3 business days from now)
        if (!state.context.shippingInfo.date) {
          const shippingDate = new Date();
          shippingDate.setDate(shippingDate.getDate() + 3); // 3 days from now
          state.context.shippingInfo.date = shippingDate.toISOString();
        }
      }
      return { currentResponse: response, context: state.context };
    };

    /**
     * ----------------------------------------------------------------
     * Graphs = Used by the graph to define the flow of conversation
     * ----------------------------------------------------------------
     * Analyze Message Node: Analyzes the message and determines the next state.
     * Identify Products Node: Identifies products mentioned in the message.
     * Create Invoice Node: Creates an invoice based on identified products.
     */
    // 4. Create the state graph
    const stateGraphChannels = {
      query: {
        value: [],
        reducer: (curr: any, newVal: any) => [...curr, newVal],
      },
      messages: {
        value: [],
        reducer: (curr: any, newVal: any) => [...curr, newVal],
      },
      context: {
        value: {},
        reducer: (curr: any, newVal: any) => ({ ...curr, ...newVal }),
      },
      currentResponse: {
        value: '',
        reducer: (_: any, newVal: any) => newVal,
      },
      conversationState: {
        value: 'greeting' as const,
        reducer: (_: any, newVal: any) => newVal,
      },
      selectedProducts: {
        value: [],
        reducer: (curr: any, newVal: any) => [...curr, ...newVal],
      },
      invoiceId: {
        value: undefined,
        reducer: (_: any, newVal: any) => newVal,
      },
    };

    // Define the graph structure
    // @ts-ignore
    const langgraphBuilder = new StateGraph({
      channels: stateGraphChannels,
    });
    langgraphBuilder.addNode('analyze_message', analyzeMessageNode);
    langgraphBuilder.addNode('inquire_company', companyInquiryNode);
    langgraphBuilder.addNode('create_invoice', createInvoiceNode);
    langgraphBuilder.addNode('update_invoice', updateInvoiceNode);
    langgraphBuilder.addNode('generate_response', generateResponseNode);
    // 7. Add edges to connect the nodes
    langgraphBuilder.addConditionalEdges(
      // @ts-ignore
      'analyze_message',
      (state: GraphState) => {
        this.logger.log(
          'Analyze message state... : ' + state.conversationState,
        );
        // Route based on the determined state
        // If products were identified AND state suggests invoice...
        if (
          state.conversationState === 'invoice_creation' &&
          state.selectedProducts.length > 0
        ) {
          return 'create_invoice';
        }
        // If invoice update state and products were selected
        if (
          state.conversationState === 'invoice_update' &&
          state.selectedProducts.length > 0
        ) {
          return 'update_invoice';
        }

        // Add other conditions based on state.conversationState
        // Maybe route back to analyze_message if needsMoreInfo?
        // Or directly to generate_response
        switch (state.conversationState) {
          // case 'product_identification': // This state might mean "ask clarifying questions" now
          //   return 'generate_response';
          case 'company_inquiry':
            return 'inquire_company';
          case 'invoice_creation': // If no products, maybe ask again?
            return 'generate_response'; // Or a specific "clarify products" node
          default:
            return 'generate_response';
        }
      },
    );

    // @ts-ignore
    langgraphBuilder.addEdge('create_invoice', 'generate_response');
    // @ts-ignore
    langgraphBuilder.addEdge('update_invoice', 'generate_response');
    // @ts-ignore
    langgraphBuilder.setEntryPoint('analyze_message');

    this.graph = langgraphBuilder.compile();
  }

  // Add this method to the LangGraphService class
  async processMessage(message: string, context: CallMetadataDto) {
    try {
      // Initialize the state with the message and context
      const initialState: GraphState = {
        query: message,
        currentResponse: '',
        messages: [...context.messages!, `User: ${message}`],
        conversationState: 'greeting',
        selectedProducts: [],
        context: context,
      };

      // Execute the graph with the initial state
      const result = await this.graph.invoke(initialState);

      const collectedResponses = [
        ...result.messages,
        `Agent: ${result.currentResponse}`,
      ];

      return {
        response: result.currentResponse,
        state: result.conversationState,
        selectedProducts: result.selectedProducts,
        invoices: result.context.invoices,
        invoiceId: result.context.invoiceId,
        messages: collectedResponses,
      };
    } catch (error) {
      this.logger.error(
        `Error processing message: ${error.message}`,
        error.stack,
      );
      return {
        response: "I'm sorry, I encountered an error processing your request.",
        error: error.message,
      };
    }
  }
}
