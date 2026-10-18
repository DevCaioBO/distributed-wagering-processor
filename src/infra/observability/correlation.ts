import { AsyncLocalStorage } from 'node:async_hooks';

export interface CorrelationContext {
  correlationId: string;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

/** Executa `fn` com o correlationId propagado por toda a cadeia assíncrona. */
export function runWithCorrelation<T>(correlationId: string, fn: () => T): T {
  return storage.run({ correlationId }, fn);
}

/** CorrelationId do contexto atual, se houver. */
export function currentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
