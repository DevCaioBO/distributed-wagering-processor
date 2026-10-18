import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { GetWagerTransactionUseCase } from '../application/get-wager-transaction.use-case.js';
import { WagerTransactionNotFoundError } from '../application/errors.js';

/**
 * Consulta de transações: por id interno ou pelo par
 * (providerId, externalTransactionId) usado pelo provedor.
 */
@Controller('wager-transactions')
export class WagerTransactionsController {
  constructor(private readonly em: EntityManager) {}

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.lookup({ id });
  }

  @Get()
  async getByProviderExternal(
    @Query('providerId') providerId?: string,
    @Query('externalTransactionId') externalTransactionId?: string,
  ) {
    if (!providerId || !externalTransactionId) {
      throw new BadRequestException('providerId e externalTransactionId são obrigatórios');
    }
    return this.lookup({ providerId, externalTransactionId });
  }

  private async lookup(
    query: Parameters<GetWagerTransactionUseCase['execute']>[0],
  ): Promise<Record<string, unknown>> {
    const useCase = new GetWagerTransactionUseCase(this.em);
    try {
      const tx = await useCase.execute(query);
      return {
        id: tx.id,
        providerId: tx.providerId,
        externalTransactionId: tx.externalTransactionId,
        walletId: tx.walletId,
        playerId: tx.playerId,
        roundId: tx.roundId,
        gameId: tx.gameId,
        kind: tx.kind,
        money: tx.money.toJSON(),
        referenceExternalTransactionId: tx.referenceExternalTransactionId ?? null,
        referenceTransactionId: tx.referenceTransactionId ?? null,
        status: tx.status,
        failureCode: tx.failureCode ?? null,
        createdAt: tx.createdAt.toISOString(),
        processedAt: tx.processedAt?.toISOString() ?? null,
      };
    } catch (error) {
      if (error instanceof WagerTransactionNotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }
}
