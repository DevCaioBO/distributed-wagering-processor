import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { FailureCode } from '../../domain/failure-code.js';
import {
  IdempotencyConflictError,
  PayloadValidationError,
  WalletAlreadyExistsError,
  WalletNotFoundError,
  WagerTransactionNotFoundError,
} from '../../application/errors.js';
import { currentCorrelationId } from '../observability/correlation.js';

interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  failureCode?: FailureCode;
  details?: string[];
  correlationId?: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    const correlationId = currentCorrelationId();
    const problem: ProblemDetails = {
      type: 'about:blank',
      title: 'Internal Server Error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      correlationId,
    };

    if (exception instanceof PayloadValidationError) {
      problem.status = HttpStatus.BAD_REQUEST;
      problem.title = 'Payload inválido';
      problem.detail = exception.message;
      problem.details = exception.details;
    } else if (exception instanceof IdempotencyConflictError) {
      problem.status = HttpStatus.CONFLICT;
      problem.title = 'Conflito de idempotência';
      problem.detail = exception.message;
    } else if (exception instanceof WalletAlreadyExistsError) {
      problem.status = HttpStatus.CONFLICT;
      problem.title = 'Carteira já existe';
      problem.detail = exception.message;
    } else if (exception instanceof WalletNotFoundError) {
      problem.status = HttpStatus.NOT_FOUND;
      problem.title = 'Carteira não encontrada';
      problem.detail = exception.message;
    } else if (exception instanceof WagerTransactionNotFoundError) {
      problem.status = HttpStatus.NOT_FOUND;
      problem.title = 'Transação não encontrada';
      problem.detail = exception.message;
    } else if (exception instanceof HttpException) {
      problem.status = exception.getStatus();
      problem.title = exception.name;
      problem.detail = exception.message;
    } else {
      problem.detail = exception instanceof Error ? exception.message : String(exception);
    }

    res.status(problem.status).json(problem);
  }
}
