import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import {
  GetWalletLedgerUseCase,
  LEDGER_MAX_LIMIT,
  type LedgerEntryResponse,
} from '../application/get-wallet-ledger.use-case.js';
import { WalletNotFoundError } from '../application/errors.js';

interface LedgerResponse {
  walletId: string;
  entries: LedgerEntryResponse[];
  nextCursor: string | null;
}

/**
 * Página do ledger com cursor opaco e estável (base64url de
 * "ISO|uuid"). O cliente deve tratar o cursor como string opaca.
 */
@Controller('wallets/:id/ledger')
export class WalletLedgerController {
  constructor(private readonly em: EntityManager) {}

  @Get()
  async getLedger(
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<LedgerResponse> {
    const useCase = new GetWalletLedgerUseCase(this.em);
    try {
      const result = await useCase.execute(id, {
        ...(cursor !== undefined && cursor !== '' ? { cursor } : {}),
        ...(limit !== undefined ? { limit: this.parseLimit(limit) } : {}),
      });
      return { walletId: id, entries: result.entries, nextCursor: result.nextCursor };
    } catch (error) {
      if (error instanceof WalletNotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  private parseLimit(limit: string): number {
    const value = Number.parseInt(limit, 10);
    if (!Number.isInteger(value) || value < 1 || value > LEDGER_MAX_LIMIT) {
      throw new NotFoundException(`limit must be an integer between 1 and ${LEDGER_MAX_LIMIT}`);
    }
    return value;
  }
}
