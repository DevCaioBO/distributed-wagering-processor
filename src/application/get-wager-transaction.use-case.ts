import type { EntityManager } from '@mikro-orm/postgresql';
import type { WagerTransaction } from '../domain/wager-transaction.js';
import type { WagerTransactionRow } from '../infra/database/rows.js';
import { toWagerTransaction } from '../infra/database/wager-transaction.mapper.js';
import { WagerTransactionNotFoundError } from './errors.js';

export interface GetWagerTransactionQuery {
  readonly id?: string;
  readonly providerId?: string;
  readonly externalTransactionId?: string;
}

export interface GetWagerTransactionUseCasePort {
  execute(query: GetWagerTransactionQuery): Promise<WagerTransaction>;
}

/**
 * Consulta de uma wager transaction por id interno ou pelo par
 * (providerId, externalTransactionId).
 *
 * Leitura pura: sem lock e sem escrita. O `order by created_at` estabiliza o
 * caso do replay, em que duas linhas com o mesmo `external_transaction_id`
 * podem existir (a original e a de uma reentrega concorrente).
 */
export class GetWagerTransactionUseCase implements GetWagerTransactionUseCasePort {
  constructor(private readonly em: EntityManager) {}

  async execute(query: GetWagerTransactionQuery): Promise<WagerTransaction> {
    const row = await this.findRow(query);

    if (row === null) {
      throw new WagerTransactionNotFoundError(
        query.id !== undefined
          ? query.id
          : `${query.providerId}/${query.externalTransactionId}`,
      );
    }

    return toWagerTransaction(row);
  }

  private async findRow(query: GetWagerTransactionQuery): Promise<WagerTransactionRow | null> {
    if (query.id !== undefined) {
      const rows = await this.em.execute<WagerTransactionRow[]>(
        'select * from wager_transactions where id = ?::uuid',
        [query.id],
        'all',
      );
      return rows[0] ?? null;
    }

    if (query.providerId === undefined || query.externalTransactionId === undefined) {
      throw new WagerTransactionNotFoundError('consulta deve informar id ou (providerId + externalTransactionId)');
    }

    const rows = await this.em.execute<WagerTransactionRow[]>(
      `select * from wager_transactions
        where provider_id = ?
          and external_transaction_id = ?
        order by created_at
        limit 1`,
      [query.providerId, query.externalTransactionId],
      'all',
    );
    return rows[0] ?? null;
  }
}
