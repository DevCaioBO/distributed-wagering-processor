import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { CreateWalletUseCase } from '../application/create-wallet.use-case.js';
import {
  ReconcileWalletUseCase,
  type ReconcileWalletResult,
} from '../application/reconcile-wallet.use-case.js';
import {
  WalletNotFoundError,
  type WalletAlreadyExistsError,
} from '../application/errors.js';
import { toWallet } from '../infra/database/wallet.mapper.js';
import type { WalletRow } from '../infra/database/rows.js';
import { JsonLogger } from '../infra/observability/json-logger.js';
import { defaultMetrics } from '../infra/observability/metrics.js';
import { WalletSchema } from '../infra/database/schemas.js';
import type { CreateWalletDto } from './dto/create-wallet.dto.js';

export interface WalletResponse {
  id: string;
  playerId: string;
  currency: string;
  balance: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fachada HTTP das wallets. Toda escrita passa pelos use cases da camada de
 * aplicação; aqui só ficam tradução de DTO/erros e consultas simples.
 */
@Injectable()
export class WalletsService {
  private readonly logger = new JsonLogger();

  constructor(private readonly em: EntityManager) {}

  async create(dto: CreateWalletDto, correlationId: string): Promise<WalletResponse> {
    const useCase = new CreateWalletUseCase(this.em, this.logger);
    const result = await useCase.execute({
      playerId: dto.playerId,
      initialBalance: dto.initialBalance,
      correlationId,
    });
    return this.loadResponse(result.id);
  }

  async findById(id: string): Promise<WalletResponse> {
    return this.loadResponse(id);
  }

  async reconcile(id: string): Promise<ReconcileWalletResult> {
    const useCase = new ReconcileWalletUseCase(this.em, defaultMetrics, this.logger);
    try {
      return await useCase.execute(id);
    } catch (error) {
      if (error instanceof WalletNotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  private async loadResponse(id: string): Promise<WalletResponse> {
    const row = (await this.em.findOne(WalletSchema, { id })) as WalletRow | null;
    if (row === null) {
      throw new NotFoundException(`Wallet ${id} not found`);
    }
    const wallet = toWallet(row);
    const { amount } = wallet.balance.toJSON();
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      currency: wallet.currency,
      balance: amount,
      version: wallet.version,
      createdAt: wallet.createdAt.toISOString(),
      updatedAt: wallet.updatedAt.toISOString(),
    };
  }
}

// Re-exportado para os controllers tiparem catches de conflito.
export type { WalletAlreadyExistsError };
