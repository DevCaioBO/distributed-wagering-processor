import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import mikroOrmConfig from './infra/database/mikro-orm.config.js';
import { HealthController } from './health/health.controller.js';

 
@Module({
  imports: [MikroOrmModule.forRoot(mikroOrmConfig)],
  controllers: [HealthController],
})
export class AppModule {}