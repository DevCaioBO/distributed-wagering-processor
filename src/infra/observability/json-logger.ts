import type { LogLevel, LoggerPort } from '../../application/ports/logger.port.js';
import { currentCorrelationId } from './correlation.js';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface JsonLoggerOptions {
  minLevel?: LogLevel;
  /** Destino do stream — injetável para os testes capturarem a saída. */
  sink?: (line: string) => void;
}

function defaultSink(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Logger estruturado: uma linha JSON por evento, com correlationId do
 * AsyncLocalStorage quando existe. Warnings/errors vão para stderr para não
 * poluir a saída normal do processo.
 */
export class JsonLogger implements LoggerPort {
  private readonly minLevel: LogLevel;
  private readonly sink: (line: string) => void;

  constructor(options: JsonLoggerOptions = {}) {
    this.minLevel = options.minLevel ?? 'info';
    this.sink = options.sink ?? defaultSink;
  }

  debug(msg: string, fields?: Record<string, unknown>): void {
    this.write('debug', msg, fields);
  }

  info(msg: string, fields?: Record<string, unknown>): void {
    this.write('info', msg, fields);
  }

  warn(msg: string, fields?: Record<string, unknown>): void {
    this.write('warn', msg, fields);
  }

  error(msg: string, fields?: Record<string, unknown>): void {
    this.write('error', msg, fields);
  }

  private write(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) {
      return;
    }
    const correlationId = currentCorrelationId();
    const record: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      msg,
      ...(correlationId !== undefined ? { correlationId } : {}),
      ...fields,
    };
    this.sink(JSON.stringify(record, jsonSafe));
  }
}

/** Erros serializados com mensagem/nome/classe — o JSON puro perde Error. */
function jsonSafe(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

/** Logger que descarta tudo — usado em testes unitários que não exercitam logs. */
export const noopLogger: LoggerPort = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
