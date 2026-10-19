import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { GetWagerTransactionUseCase } from '../application/get-wager-transaction.use-case.js';
import { WagerTransactionNotFoundError } from '../application/errors.js';

/**
 * Rota canônica do desafio para o provedor consultar a própria transação:
 * `GET /providers/:providerId/wagering/transactions/:externalTransactionId`.
 */
@Controller('providers/:providerId/wagering')
export class ProviderTransactionsController {
  constructor(private readonly em: EntityManager) {}

  @Get('transactions/:externalTransactionId')
  async getByExternal(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ) {
    const useCase = new GetWagerTransactionUseCase(this.em);
    try {
      const tx = await useCase.execute({ providerId, externalTransactionId });
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
