export interface WageringConfig {
  /** Backoff base para reprocessar referências ausentes. */
  referenceRetryBaseMs: number;
  /** Limite de tentativas antes de rejeitar com REFERENCE_NOT_FOUND. */
  referenceMaxAttempts: number;
}

/**
 * Política de reprocessamento de referências fora de ordem (seção 7.1):
 * backoff exponencial a partir de `referenceRetryBaseMs` (1s, 2s, 4s, ... com
 * teto de 60s) até `referenceMaxAttempts` tentativas; esgotado o limite a
 * transação vira REJECTED com REFERENCE_NOT_FOUND e o evento é publicado.
 * Com os padrões são ~17 minutos de janela — tempo típico para o provedor
 * corrigir e reenviar. Os valores vêm do ambiente para os testes usarem
 * backoffs curtos sem mudar a política.
 */
export function wageringConfigFromEnv(env: Record<string, string | undefined> = process.env): WageringConfig {
  const base = Number.parseInt(env.REFERENCE_RETRY_BASE_MS ?? '1000', 10);
  const max = Number.parseInt(env.REFERENCE_MAX_ATTEMPTS ?? '10', 10);
  return {
    referenceRetryBaseMs: Number.isFinite(base) && base > 0 ? base : 1_000,
    referenceMaxAttempts: Number.isFinite(max) && max > 0 ? max : 10,
  };
}

/** Backoff exponencial com teto, alinhado com o domínio (outbox). */
export function referenceBackoffMs(baseMs: number, attempts: number, maxMs = 60_000): number {
  return Math.min(baseMs * 2 ** Math.max(attempts - 1, 0), maxMs);
}
