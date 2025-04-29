import { Module } from '@nestjs/common';
import { LangGraphService } from './services/langgraph.service';
import { ProductService } from './services/product.service';
import { InvoiceService } from './services/invoice.service';
import { LangGraphController } from './controllers/langgraph.controller';

@Module({
  providers: [LangGraphService, ProductService, InvoiceService],
  controllers: [LangGraphController],
  exports: [LangGraphService],
})
export class LangGraphModule {}
