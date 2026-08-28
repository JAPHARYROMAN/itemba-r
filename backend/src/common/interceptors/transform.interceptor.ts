import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { SSE_METADATA } from '@nestjs/common/constants';
import { Observable, map } from 'rxjs';
import { DIRECT_MTLS_DEVICE_KEY } from '../decorators/direct-mtls-device.decorator';

/**
 * Wraps all successful responses in a consistent envelope:
 * `{ success: true, data: <payload>, timestamp }`.
 * Callers and the frontend API client rely on this shape.
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, unknown> {
  intercept(ctx: ExecutionContext, next: CallHandler<T>): Observable<unknown> {
    // Nest serializes each value from an @Sse() handler as a MessageEvent. An
    // ordinary JSON response envelope would hide its top-level `id`, `type`,
    // and `data`, replacing durable cursors with Nest's synthetic sequence IDs.
    if (Reflect.getMetadata(SSE_METADATA, ctx.getHandler()) === true) {
      return next.handle();
    }

    // The signed Windows companions deserialize exact top-level wire DTOs.
    // These routes are isolated on the direct client-certificate listener and
    // explicitly marked at the controller/handler boundary; wrapping them in
    // the human API envelope would silently turn polls into empty responses.
    if (
      Reflect.getMetadata(DIRECT_MTLS_DEVICE_KEY, ctx.getHandler()) === true ||
      Reflect.getMetadata(DIRECT_MTLS_DEVICE_KEY, ctx.getClass()) === true
    ) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        if (data instanceof StreamableFile) return data;
        return {
          success: true,
          data,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
