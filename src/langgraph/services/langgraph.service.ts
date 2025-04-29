import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { START, StateGraph } from '@langchain/langgraph';
import { RunnableSequence } from '@langchain/core/runnables';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import {
  StringOutputParser,
  StructuredOutputParser,
} from '@langchain/core/output_parsers';
import { z } from 'zod';
import { ProductService } from './product.service';
import { InvoiceService } from './invoice.service';
import { CallMetadataDto } from '../../audio/dto/call-metadata.dto';

@Injectable()
export class LangGraphService implements OnModuleInit {
  private readonly logger = new Logger(LangGraphService.name);
  private model: ChatOpenAI;
  private graph: any; // CompiledStateGraph
  constructor(
    private readonly configService: ConfigService,
    private readonly productService: ProductService,
    private readonly invoiceService: InvoiceService,
  ) {}

  onModuleInit() {
    const openAiModel = this.configService.get<string>(
      'OPENAI_MODEL_NAME',
      'gpt-4',
    );
    // Initialize the LLM
    this.model = new ChatOpenAI({
      openAIApiKey: this.configService.get<string>('OPENAI_API_KEY'),
      model: openAiModel,
      temperature: 0.2, // Lower temperature for more deterministic outputs
    });

    // Create the graph
    this.initializeGraph();

    this.logger.log(`LangGraph service initialized using ${openAiModel}`);
  }

  private initializeGraph() {
    // Define output parsers
    const stateOutputParser = StructuredOutputParser.fromZodSchema(
      z.object({
        nextState: z.enum([
          'greeting',
          'understanding_problem',
          'product_identification',
          'invoice_creation',
          'providing_solution',
          'farewell',
        ]),
        reasoning: z.string(),
      }),
    );

    const productOutputParser = StructuredOutputParser.fromZodSchema(
      z.object({
        products: z.array(
          z.object({
            productName: z.string(),
            quantity: z.number().default(1),
            confidence: z.number().min(0).max(1),
          }),
        ),
        needsMoreInfo: z.boolean(),
      }),
    );

    // Get all products for reference
    const allProducts = this.productService.getAllProducts();
    const productCatalog = allProducts
      .map(
        (p) =>
          `ID: ${p.id}, Name: ${p.name}, Description: ${p.description}, Price: ${p.price}, Category: ${p.category}`,
      )
      .join('\n');

    // 1. Determine the conversation state
    const determineState = RunnableSequence.from([
      ChatPromptTemplate.fromTemplate(
        `Based on the conversation history and the latest user message, determine the next state of the conversation.
        
        Conversation history: {history}
        Latest user message: {message}
        Current state: {currentState}
        
        Possible states:
        - greeting: Initial greeting or introduction
        - understanding_problem: Trying to understand the user's problem or request
        - product_identification: Identifying products mentioned by the user
        - invoice_creation: Creating an invoice based on identified products
        - providing_solution: Providing a solution or answer to the user
        - farewell: Ending the conversation
        
        {format_instructions}`,
      ),
      this.model,
      stateOutputParser,
    ]);

    // 2. Identify products mentioned in the conversation
    const identifyProducts = RunnableSequence.from([
      ChatPromptTemplate.fromTemplate(
        `You are a product identification assistant. Identify any products mentioned in the conversation.
        
        Product Catalog:
        ${productCatalog}
        
        Conversation history: {history}
        Latest user message: {message}
        
        Identify any products from our catalog that the user is talking about, including quantities if mentioned.
        If you're not sure about a product, indicate a lower confidence score.
        
        {format_instructions}`,
      ),
      this.model,
      productOutputParser,
    ]);

    // 3. Generate response based on state
    const generateResponse = RunnableSequence.from([
      ChatPromptTemplate.fromTemplate(
        `You are a helpful customer service assistant for a company that sells milk.
        Generate a response based on the conversation state.
        
        Conversation history: {history}
        Latest user message: {message}
        Current state: {currentState}
        Context: {context}
        Identified Products: {identifiedProducts}
        Invoice Information: {invoiceInfo}
        
        Your response should be appropriate for the current state of the conversation.
        If products have been identified, acknowledge them in your response.
        If an invoice has been created, provide the receipt number and total.`,
      ),
      this.model,
      new StringOutputParser(),
    ]);

    // 4. Create the state graph
    const stateGraphChannels = {
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
      identifiedProducts: {
        value: [],
        reducer: (curr: any, newVal: any) => [...curr, ...newVal],
      },
      invoiceId: {
        value: undefined,
        reducer: (_: any, newVal: any) => newVal,
      },
    };

    // Define the graph structure for the flight booking process
    // @ts-ignore
    const langgraphBuilder = new StateGraph({
      channels: stateGraphChannels,
    });

    // 5. Add nodes to the graph
    const determineStateNode = async (state: {
      messages: string[];
      conversationState: string;
    }) => {
      const history = state.messages.slice(0, -1).join('\n');
      const lastMessage = state.messages[state.messages.length - 1];

      const stateResult = await determineState.invoke({
        history,
        message: lastMessage,
        currentState: state.conversationState,
        format_instructions: stateOutputParser.getFormatInstructions(),
      });

      return { conversationState: stateResult.nextState };
    };

    const identifyProductsNode = async (state: {
      messages: string[];
      conversationState: string;
    }) => {
      const history = state.messages.join('\n');
      const lastMessage = state.messages[state.messages.length - 1];

      const productResult = await identifyProducts.invoke({
        history,
        message: lastMessage,
        format_instructions: productOutputParser.getFormatInstructions(),
      });

      // Map identified product names to actual product IDs
      const identifiedProducts = productResult.products
        .map((p) => {
          const matchedProducts = this.productService.searchProducts(
            p.productName,
          );
          if (matchedProducts.length > 0) {
            return {
              productId: matchedProducts[0].id,
              quantity: p.quantity,
              confidence: p.confidence,
            };
          }
          return null;
        })
        .filter((p) => p !== null);

      return { identifiedProducts };
    };

    const createInvoiceNode = (state: {
      messages: string[];
      conversationState: string;
      identifiedProducts: any[];
      context: CallMetadataDto;
    }) => {
      // Only create invoice if we have identified products with high confidence
      const highConfidenceProducts = state.identifiedProducts.filter(
        (p) => p.confidence > 0.7,
      );

      if (highConfidenceProducts.length === 0) {
        return {}; // No products to create invoice for
      }

      // Get customer info from context
      const customerId = state.context.callerId || 'unknown';
      const customerName = state.context.callerName || 'Unknown Customer';
      const customerPhone = state.context.callerPhone || '';

      // Create order items
      const orderItems = highConfidenceProducts.map((p) => {
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

      // Create the invoice
      const invoice = this.invoiceService.createInvoice(
        customerId,
        customerName,
        customerPhone,
        orderItems,
        `Created from conversation on ${new Date().toISOString()}`,
      );

      // Generate receipt number
      const receiptNumber = this.invoiceService.generateReceiptNumber(
        invoice.id,
      );

      this.logger.log(
        `Created invoice ${invoice.id} with receipt number ${receiptNumber}`,
      );

      return { invoiceId: invoice.id };
    };

    const generateResponseNode = async (state: {
      messages: string[];
      identifiedProducts: Array<{
        productId: string;
        quantity: number;
        confidence: number;
      }>;
      conversationState: string;
      context: CallMetadataDto;
    }) => {
      const history = state.messages.slice(0, -1).join('\n');
      const lastMessage = state.messages[state.messages.length - 1];

      // Get invoice information if available
      let invoiceInfo = 'No invoice created yet.';
      if (state.context.invoiceId) {
        const invoice = this.invoiceService.getInvoice(state.context.invoiceId);
        if (invoice) {
          invoiceInfo = `
            Invoice ID: ${invoice.id}
            Receipt Number: ${invoice.receiptNumber}
            Customer: ${invoice.customerName}
            Items: ${invoice.items!.map((item) => `${item.quantity}x ${item.product.name} @ ${item.unitPrice}`).join(', ')}
            Total: ${invoice.total.toFixed(2)}
          `;
        }
      }

      // Format identified products for the prompt
      const identifiedProductsText =
        state.identifiedProducts.length > 0
          ? state.identifiedProducts
              .map((p) => {
                const product = this.productService.getProductById(p.productId);
                return `${p.quantity}x ${product!.name} (Confidence: ${(p.confidence * 100).toFixed(0)}%)`;
              })
              .join('\n')
          : 'No products identified yet.';

      const response = await generateResponse.invoke({
        history,
        message: lastMessage,
        currentState: state.conversationState,
        context: JSON.stringify(state.context),
        identifiedProducts: identifiedProductsText,
        invoiceInfo,
      });

      return { currentResponse: response };
    };

    langgraphBuilder.addNode('determine_state', determineStateNode);
    langgraphBuilder.addNode('identify_products', identifyProductsNode);
    langgraphBuilder.addNode('create_invoice', createInvoiceNode);
    langgraphBuilder.addNode('generate_response', generateResponseNode);
    // 7. Add edges to connect the nodes
    langgraphBuilder.addConditionalEdges(
      // @ts-ignore
      'determine_state',
      ({ conversationState }) => {
        // Route based on the determined state
        switch (conversationState) {
          case 'product_identification':
            return 'identify_products';
          case 'invoice_creation':
            return 'create_invoice';
          default:
            return 'generate_response';
        }
      },
    );

    // @ts-ignore
    langgraphBuilder.addEdge('identify_products', 'create_invoice');
    // @ts-ignore
    langgraphBuilder.addEdge('create_invoice', 'generate_response');
    // @ts-ignore
    langgraphBuilder.setEntryPoint('determine_state');

    this.graph = langgraphBuilder.compile();
  }

  // Add this method to the LangGraphService class
  async processMessage(message: string, context: any = {}) {
    try {
      // Initialize the state with the message and context
      const initialState: ConversationState = {
        currentResponse: '',
        messages: [message],
        conversationState: 'greeting',
        identifiedProducts: [],
        context: context,
      };

      // Execute the graph with the initial state
      const result = await this.graph.invoke(initialState);

      return {
        response: result.currentResponse,
        state: result.conversationState,
        identifiedProducts: result.identifiedProducts,
        invoiceId: result.invoiceId,
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
