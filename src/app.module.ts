import { Module } from '@nestjs/common';
import { AudioModule } from './audio/audio.module';
import { ConfigModule } from '@nestjs/config';
import * as path from 'path';
import { LangGraphModule } from './langgraph/langgraph.module';

@Module({
  imports: [
    AudioModule,
    LangGraphModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.ENV_FILE
        ? path.resolve(process.cwd(), process.env.ENV_FILE)
        : '.env',
    }),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
