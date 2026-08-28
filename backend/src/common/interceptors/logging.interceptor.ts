import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request } from 'express';
import { PersistenceSecretGuard } from '../services';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly persistenceSecrets: PersistenceSecretGuard) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const { method, url } = req;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const elapsed = Date.now() - start;
          this.logger.log(
            this.persistenceSecrets.sanitizeText(`${method} ${url} — ${elapsed}ms`).value,
          );
        },
        error: (error: unknown) => {
          const elapsed = Date.now() - start;
          const status =
            typeof error === 'object' && error !== null && 'status' in error
              ? String((error as { status?: unknown }).status)
              : 'error';
          this.logger.warn(
            this.persistenceSecrets.sanitizeText(`${method} ${url} — ${status} — ${elapsed}ms`)
              .value,
          );
        },
      }),
    );
  }
}
