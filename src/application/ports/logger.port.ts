export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Porta de logging estruturado. A implementação escreve JSON com o
 * correlationId do contexto (AsyncLocalStorage) na infraestrutura.
 */
export interface LoggerPort {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}
