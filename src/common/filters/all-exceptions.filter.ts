import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import {
  BusinessRuleViolationError,
  ConflictError,
  DomainError,
  ForbiddenActionError,
  InvalidCredentialsError,
  InvalidStateTransitionError,
  ResourceNotFoundError,
} from '../errors/domain.errors';

export interface ErrorResponseBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
  path: string;
  timestamp: string;
}

const PG_UNIQUE_VIOLATION = '23505';

/**
 * Centralised error handling. Produces one consistent error envelope and makes sure
 * unexpected errors never leak internals (stack traces, SQL) to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request & { id?: string }>();
    const response = ctx.getResponse<Response>();

    const { statusCode, code, message, details } = this.resolve(exception);

    if (statusCode >= 500) {
      this.logger.error(
        { err: exception, requestId: request.id },
        'Unhandled exception while processing request',
      );
    }

    const body: ErrorResponseBody = {
      statusCode,
      code,
      message,
      ...(details !== undefined && { details }),
      requestId: request.id,
      path: request.url,
      timestamp: new Date().toISOString(),
    };
    response.status(statusCode).json(body);
  }

  private resolve(exception: unknown): Omit<ErrorResponseBody, 'path' | 'timestamp'> {
    if (exception instanceof DomainError) {
      return {
        statusCode: this.statusForDomainError(exception),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const res = exception.getResponse();
      const raw = typeof res === 'string' ? res : (res as { message?: string | string[] }).message;
      // ValidationPipe returns an array of constraint messages.
      if (Array.isArray(raw)) {
        return {
          statusCode,
          code: 'VALIDATION_FAILED',
          message: 'Validation failed',
          details: raw,
        };
      }
      return {
        statusCode,
        code: HttpStatus[statusCode] ?? 'HTTP_ERROR',
        message: raw ?? exception.message,
      };
    }

    if (
      exception instanceof QueryFailedError &&
      (exception.driverError as { code?: string } | undefined)?.code === PG_UNIQUE_VIOLATION
    ) {
      return {
        statusCode: HttpStatus.CONFLICT,
        code: 'CONFLICT',
        message: 'Resource already exists',
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    };
  }

  private statusForDomainError(error: DomainError): number {
    if (error instanceof ResourceNotFoundError) return HttpStatus.NOT_FOUND;
    if (error instanceof ForbiddenActionError) return HttpStatus.FORBIDDEN;
    if (error instanceof InvalidCredentialsError) return HttpStatus.UNAUTHORIZED;
    if (error instanceof InvalidStateTransitionError) return HttpStatus.CONFLICT;
    if (error instanceof BusinessRuleViolationError) return HttpStatus.UNPROCESSABLE_ENTITY;
    if (error instanceof ConflictError) return HttpStatus.CONFLICT;
    return HttpStatus.BAD_REQUEST;
  }
}
