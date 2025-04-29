import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Product } from '../interfaces/product';

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);
  private products: Product[] = [];

  constructor(private readonly configService: ConfigService) {
    // Initialize with some sample products
    this.initializeProducts();
  }

  private initializeProducts() {
    // Sample products - in a real application, these would come from a database
    this.products = [
      {
        id: 'p001',
        name: 'Infant Formula Milk Powder',
        description: 'Premium infant formula for babies 0-6 months',
        price: 299.99,
        category: 'Baby',
        sku: 'MILK-INF-001',
      },
      {
        id: 'p002',
        name: 'Follow-on Formula Milk Powder',
        description: 'Nutritious formula for babies 6-12 months',
        price: 329.99,
        category: 'Baby',
        sku: 'MILK-FOL-002',
      },
      {
        id: 'p003',
        name: 'Toddler Milk Powder',
        description: 'Complete nutrition for toddlers 1-3 years',
        price: 349.99,
        category: 'Baby',
        sku: 'MILK-TOD-003',
      },
      // Add more products as needed
    ];
  }

  getAllProducts(): Product[] {
    return this.products;
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
}
