import { Controller, Get, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(EntityManager) private readonly em: EntityManager) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    try {
      await this.em.execute('select 1');
    } catch (error) {
      this.logger.error('Database is not reachable', error instanceof Error ? error.message : '');
      throw new ServiceUnavailableException({ status: 'unavailable', database: 'down' });
    }
    return { status: 'ok', database: 'up' };
  }
}