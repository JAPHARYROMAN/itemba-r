import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

/**
 * Maps known Prisma errors to stable HTTP responses so callers get
 * predictable error codes instead of opaque 500s.
 */
@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientValidationError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(
    exception: Prisma.PrismaClientKnownRequestError | Prisma.PrismaClientValidationError,
    host: ArgumentsHost,
  ) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string = 'Database error';

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002': // unique constraint
          status = HttpStatus.CONFLICT;
          message = 'Duplicate value violates a unique constraint';
          break;
        case 'P2025': // record not found
          status = HttpStatus.NOT_FOUND;
          message = 'Record not found';
          break;
        case 'P2003': // foreign key
          status = HttpStatus.BAD_REQUEST;
          message = 'Invalid reference (foreign key constraint failed)';
          break;
        default:
          // Do not leak raw driver/schema details to the client; log server-side.
          this.logger.error(
            `[${request.method}] ${request.url} → Prisma ${exception.code}: ${exception.message.split('\n').pop()}`,
          );
          message = 'Database error';
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Invalid data provided to the database layer';
    }

    if (status >= 500) {
      this.logger.error(`[${request.method}] ${request.url} → Prisma error`, exception.stack);
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      error: 'Database Error',
      message,
      path: request.url,
      method: request.method,
      timestamp: new Date().toISOString(),
    });
  }
}
