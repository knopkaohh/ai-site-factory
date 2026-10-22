import type { NextFunction, Request, Response } from 'express';
import type { FieldError } from '../../../shared/src/index';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: FieldError[];

  constructor(status: number, code: string, message: string, details?: FieldError[]) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ParserError {
  type?: string;
  status?: number;
}

function asParserError(error: unknown): ParserError | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  return error as ParserError;
}

export function errorHandler(error: unknown, _request: Request, response: Response, _next: NextFunction): void {
  if (error instanceof HttpError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
    return;
  }

  const parserError = asParserError(error);
  if (parserError?.type === 'entity.parse.failed') {
    response.status(400).json({
      error: { code: 'BAD_JSON', message: 'Некорректный JSON в теле запроса' },
    });
    return;
  }
  if (parserError?.type === 'entity.too.large') {
    response.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Тело запроса слишком большое' },
    });
    return;
  }

  console.error(error);
  response.status(500).json({
    error: { code: 'INTERNAL', message: 'Внутренняя ошибка сервера' },
  });
}

export function asyncHandler(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction): void => {
    handler(request, response, next).catch(next);
  };
}
