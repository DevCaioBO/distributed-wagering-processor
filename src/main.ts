import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ShutdownSignal } from '@nestjs/common';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  app.enableShutdownHooks([ShutdownSignal.SIGTERM, ShutdownSignal.SIGINT]);

  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(Number.isFinite(port) ? port : 3000);
  logger.log(`wagering-processor listening on port ${port}`);
}

void bootstrap();
