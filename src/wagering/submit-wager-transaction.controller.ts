import {
  Body,
  Controller,
  Headers,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import type { Request, Response } from 'express';
import { SubmitWagerTransactionUseCase } from '../application/submit-wager-transaction.use-case.js';
import { wageringConfigFromEnv } from '../application/wagering-config.js';
import { JsonLogger } from '../infra/observability/json-logger.js';
import { defaultMetrics } from '../infra/observability/metrics.js';
import { WagerTransactionStatus } from '../domain/wager-transaction.js';

interface SubmitResponse {
  transactionId: string;
  status: string;
  balance?: { amount: string; currency: string };
  idempotentReplay: boolean;
  failureCode?: string;
}

/**
 * Submissão de operações de aposta. Idempotência vem do header
 * `Idempotency-Key` (obrigatório). O status HTTP segue o desfecho:
 * PROCESSED (200), PENDING/PENDING_REFERENCE (202), REJECTED (422).
 * Payload inválido (400) e conflito de idempotência (409) são resolvidos
 * pelo exception filter global.
 */
@Controller('wager-transactions')
export class SubmitWagerTransactionController {
  private readonly logger = new JsonLogger();

  constructor(private readonly em: EntityManager) {}

  @Post()
  async submit(
    @Body() payload: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (idempotencyKey === undefined || idempotencyKey.trim() === '') {
      res.status(400).json({ message: 'Idempotency-Key header é obrigatório' });
      return;
    }
    const correlationId = (req as Request & { correlationId?: string }).correlationId ?? '';

    const useCase = new SubmitWagerTransactionUseCase(
      this.em,
      defaultMetrics,
      this.logger,
      wageringConfigFromEnv(),
    );

    const result = await useCase.execute({
      idempotencyKey,
      correlationId,
      source: 'HTTP',
      payload,
    });

    res.status(statusToHttp(result.status)).json(this.toResponse(result));
  }

  private toResponse(
    result: Awaited<ReturnType<SubmitWagerTransactionUseCase['execute']>>,
  ): SubmitResponse {
    return {
      transactionId: result.transactionId,
      status: result.status,
      ...(result.balance !== undefined ? { balance: result.balance } : {}),
      idempotentReplay: result.idempotentReplay,
      ...(result.failureCode !== undefined ? { failureCode: result.failureCode } : {}),
    };
  }
}

function statusToHttp(status: WagerTransactionStatus): number {
  switch (status) {
    case WagerTransactionStatus.Processed:
      return 200;
    case WagerTransactionStatus.Pending:
    case WagerTransactionStatus.PendingReference:
      return 202;
    case WagerTransactionStatus.Rejected:
      return 422;
    default:
      return 200;
  }
}
