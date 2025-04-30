import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Product } from '../interfaces/product';
import axios from 'axios';

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);
  private products: Product[] = [];
  private readonly crmTokenUrl: string | undefined;
  private readonly crmProductUrl: string | undefined;
  private readonly crmClientId: string | undefined;
  private readonly crmClientSecret: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.crmTokenUrl = this.configService.get<string>('CRM_TOKEN_URL');
    this.crmProductUrl = this.configService.get<string>('CRM_PRODUCT_URL');
    this.crmClientId = this.configService.get<string>('CRM_CLIENT_ID');
    this.crmClientSecret = this.configService.get<string>('CRM_CLIENT_SECRET');

    // Initialize with some sample products
    this.initializeProducts().then(() => {
      this.logger.log('Products initialized');
    });
  }

  private async initializeProducts() {
    this.products = await this.getProductsFromCrm();
  }

  async getAllProducts(): Promise<Product[]> {
    return await this.getProductsFromCrm();
  }

  getProductById(id: string): Product | undefined {
    return this.products.find((product) => product.id === id);
  }

  searchProducts(query: string): Product[] {
    const normalizedQuery = query.toLowerCase();
    return this.products.filter(
      (product) =>
        product.name.toLowerCase().includes(normalizedQuery) ||
        (product.description &&
          product.description.toLowerCase().includes(normalizedQuery)) ||
        (product.category &&
          product.category.toLowerCase().includes(normalizedQuery)),
    );
  }

  private async getProductsFromCrm(): Promise<Product[]> {
    // Check if required configuration is available
    if (
      !this.crmTokenUrl ||
      !this.crmProductUrl ||
      !this.crmClientSecret ||
      !this.crmClientId
    ) {
      this.logger.error('Missing required configuration for contact lookup');
      return [];
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

      // Step 2: Get Products
      const contactResponse = await axios.get(this.crmProductUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        httpsAgent: new (await import('https')).Agent({
          rejectUnauthorized: false,
        }),
      });

      const products = contactResponse.data.data.map((product: any) => ({
        id: product.id,
        name: product.attributes.name,
        description: product.attributes.description,
        price: product.attributes.price,
        category: product.attributes.aos_product_category_name,
        sku: product.attributes.part_number,
      }));

      this.logger.log(`Products retrieved from CRM`);

      return products;
    } catch (error) {
      this.logger.error(
        `Error in getting products from CRM: ${error.message}`,
        error.stack,
      );
      return [];
    }
  }
}
