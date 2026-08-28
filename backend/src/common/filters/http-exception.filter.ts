import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { scrubLogText } from '../utils/log-scrubber';
import { PersistenceSecretGuard } from '../services';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(private readonly persistenceSecrets: PersistenceSecretGuard) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string | object = 'Internal server error';
    let error: string | undefined;
    // A machine-readable discriminator, when the thrower supplied one.
    //
    // This filter rebuilds the response body field by field rather than passing
    // the exception's own payload through, so anything it does not name is
    // dropped between the thrower and the browser. That is the right default —
    // it is what stops an internal payload leaking — but it also means a code
    // added at a throw site is silently a no-op until this line exists.
    //
    // Only a non-empty string is carried, and only ever ALONGSIDE `message`:
    // the code is for branching, the sentence is still what the user reads. See
    // `CONVERSATION_CONFLICT_CODES` in the Msaidizi conversations service for
    // the case this was added for — two 409s that are opposite answers, told
    // apart until now only by the English in their messages.
    let code: string | undefined;
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else {
        const r = res as { message?: string | string[]; error?: string; code?: unknown };
        message = r.message ?? res;
        error = r.error;
        if (typeof r.code === 'string' && r.code.length > 0) code = r.code;
      }
    }

    const body = {
      success: false,
      statusCode: status,
      error: error ?? (status >= 500 ? 'Internal Server Error' : 'Request Error'),
      message,
      // Omitted entirely rather than sent as `undefined`: a client testing
      // `'code' in body` must not see a key that carries nothing.
      ...(code ? { code } : {}),
      path: request.url,
      method: request.method,
      timestamp: new Date().toISOString(),
    };

    if (status >= 500) {
      this.logger.error(
        this.scrub(`[${request.method}] ${request.url} → ${status}`),
        this.scrub(exception instanceof Error ? exception.stack : undefined),
      );
    } else {
      this.logger.warn(`[${request.method}] ${request.url} → ${status}`);
    }

    response.status(status).json(body);
  }

  private scrub(value: unknown): string | undefined {
    const heuristicSafe = scrubLogText(value);
    return heuristicSafe === undefined
      ? undefined
      : this.persistenceSecrets.sanitizeText(heuristicSafe).value;
  }
}
