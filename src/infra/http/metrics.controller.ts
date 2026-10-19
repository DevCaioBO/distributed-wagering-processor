import { Controller, Get, Header } from '@nestjs/common';
import { defaultMetrics } from '../observability/metrics.js';

/**
 * Exposição das métricas no formato de texto Prometheus (seção 12).
 * O registry é o `defaultMetrics` compartilhado pelo processo — o mesmo que
 * os use cases e workers incrementam.
 */
@Controller()
export class MetricsController {
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  metrics(): string {
    return defaultMetrics.render();
  }
}
