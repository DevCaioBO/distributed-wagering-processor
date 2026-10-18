import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { runWithCorrelation } from '../observability/correlation.js';
import { randomUUID } from 'node:crypto';

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const header = req.headers['x-correlation-id'];
    const correlationId =
      typeof header === 'string' && header.trim() !== ''
        ? header.trim()
        : randomUUID();
    // Propagamos no request/response para logs de infraestrutura externa.
    (req as Request & { correlationId?: string }).correlationId = correlationId;
    runWithCorrelation(correlationId, () => next());
  }
}
