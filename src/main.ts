import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const envFile = configService.get<string>('ENV_FILE') || '.env'; // Confirm the env file used
  const port = configService.get<number>('PORT', 3000); // Get PORT with a default value

  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port} with env: ${envFile}`,
  );
}

bootstrap();
