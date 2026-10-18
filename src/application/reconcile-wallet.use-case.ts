import type { EntityManager } from '@mikro-orm/postgresql';
import { Money, type MoneyProps } from '../domain/money.js';
import type { WalletRow } from '../infra/database/rows.js';
import { WalletSchema } from '../infra/database/schemas.js';
import { WalletNotFoundError } from './errors.js';
import type { LoggerPort } from './ports/logger.port.js';
import type { MetricsPort } from './ports/metrics.port.js';

export interface ReconcileWalletResult {
  walletId: string;
  storedBalance: MoneyProps;
  calculatedBalance: MoneyProps;
  difference: MoneyProps;
  consistent: boolean;
  checkedEntries: number;
}

/**
 * Compara o saldo materializado da wallet com o saldo reconstruído pelo
 * ledger (soma dos lançamentos). Divergências nunca são corrigidas
 * silenciosamente: são logadas, contabilizadas em métrica e sinalizadas.
 */
export class ReconcileWalletUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly metrics: MetricsPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(walletId: string): Promise<ReconcileWalletResult> {
    const wallet = (await this.em.findOne(WalletSchema, { id: walletId })) as WalletRow | null;
    if (wallet === null) {
      throw new WalletNotFoundError(walletId);
    }

    const result = await this.em.execute<
      { calculated: string | null; entries: string }[]
    >(
      `select coalesce(sum(case when direction = 'CREDIT' then amount else -amount end), 0)::text as calculated,
              count(*)::text as entries
         from wallet_ledger_entries where wallet_id = ?`,
      [walletId],
      'all',
    );
    const summary = result[0] ?? { calculated: '0', entries: '0' };

    const stored = Money.from({ amount: wallet.balance, currency: wallet.currency });
    const calculated = Money.from({
      amount: normalizeNumeric(summary.calculated ?? '0'),
      currency: wallet.currency,
    });
    const difference = stored.subtract(calculated);
    const consistent = stored.equals(calculated);

    this.metrics.countReconciliation(consistent);
    if (!consistent) {
      this.logger.error('wallet_reconciliation_divergence', {
        walletId,
        storedBalance: stored.toJSON().amount,
        calculatedBalance: calculated.toJSON().amount,
        difference: difference.toJSON().amount,
        checkedEntries: Number(summary.entries),
      });
    }

    return {
      walletId,
      storedBalance: stored.toJSON(),
      calculatedBalance: calculated.toJSON(),
      difference: difference.toJSON(),
      consistent,
      checkedEntries: Number(summary.entries),
    };
  }
}

/** O driver pode devolver numeric como string com escala variável; Money exige até 2 casas. */
function normalizeNumeric(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.includes('.')) {
    return `${trimmed}.00`;
  }
  const [whole, fraction = ''] = trimmed.split('.');
  return `${whole}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}
