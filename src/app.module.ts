import { Module, NestModule, MiddlewareConsumer, Global } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import mikroOrmConfig from './infra/database/mikro-orm.config.js';
import { HealthController } from './health/health.controller.js';
import { MetricsController } from './infra/http/metrics.controller.js';
import { WalletsModule } from './wallets/wallets.module.js';
import { WageringModule } from './wagering/wagering.module.js';
import { WorkersModule } from './workers/workers.module.js';
import { CorrelationMiddleware } from './infra/http/correlation.middleware.js';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { GlobalExceptionFilter } from './infra/http/global-exception.filter.js';
import { NoopAuthGuard } from './auth/noop-auth.guard.js';

@Global()
@Module({
  imports: [MikroOrmModule.forRoot(mikroOrmConfig), WalletsModule, WageringModule, WorkersModule],
  controllers: [HealthController, MetricsController],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_GUARD, useClass: NoopAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
