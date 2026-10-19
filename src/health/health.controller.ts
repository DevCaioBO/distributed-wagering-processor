import { Controller, Get, Inject, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import type { SqsGateway } from '../infra/messaging/sqs-gateway.js';
import type { SqsConfig } from '../infra/messaging/sqs-config.js';
import { SQS_CONFIG, SQS_GATEWAY } from '../workers/workers.tokens.js';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    @Inject(EntityManager) private readonly em: EntityManager,
    @Optional() @Inject(SQS_GATEWAY) private readonly sqs?: SqsGateway,
    @Optional() @Inject(SQS_CONFIG) private readonly sqsConfig?: SqsConfig,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Readiness: PostgreSQL e SQS alcançáveis (seção 9). */
  @Get('ready')
  async ready() {
    try {
      await this.em.execute('select 1');
    } catch (error) {
      this.logger.error('Database is not reachable', error instanceof Error ? error.message : '');
      throw new ServiceUnavailableException({ status: 'unavailable', database: 'down' });
    }

    if (this.sqs !== undefined && this.sqsConfig !== undefined) {
      try {
        await this.sqs.ping(this.sqsConfig.transactionsQueueUrl);
      } catch (error) {
        this.logger.error('SQS is not reachable', error instanceof Error ? error.message : '');
        throw new ServiceUnavailableException({
          status: 'unavailable',
          database: 'up',
          sqs: 'down',
        });
      }
      return { status: 'ok', database: 'up', sqs: 'up' };
    }

    return { status: 'ok', database: 'up', sqs: 'not_configured' };
  }
}
