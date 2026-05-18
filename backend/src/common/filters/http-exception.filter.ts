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

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string | object = 'Internal server error';
    let error: string | undefined;
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else {
        const r = res as { message?: string | string[]; error?: string };
        message = r.message ?? res;
        error = r.error;
      }
    }

    const body = {
      success: false,
      statusCode: status,
      error: error ?? (status >= 500 ? 'Internal Server Error' : 'Request Error'),
      message,
      path: request.url,
      method: request.method,
      timestamp: new Date().toISOString(),
    };

    if (status >= 500) {
      this.logger.error(
        scrubLogText(`[${request.method}] ${request.url} → ${status}`),
        scrubLogText(exception instanceof Error ? exception.stack : undefined),
      );
    } else {
      this.logger.warn(`[${request.method}] ${request.url} → ${status}`);
    }

    response.status(status).json(body);
  }
}
