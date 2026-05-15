import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const { method, url } = req;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const elapsed = Date.now() - start;
          this.logger.log(`${method} ${url} — ${elapsed}ms`);
        },
        error: (error: unknown) => {
          const elapsed = Date.now() - start;
          const status =
            typeof error === 'object' && error !== null && 'status' in error
              ? String((error as { status?: unknown }).status)
              : 'error';
          this.logger.warn(`${method} ${url} — ${status} — ${elapsed}ms`);
        },
      }),
    );
  }
}
