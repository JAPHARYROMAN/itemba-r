import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IS_JWT_REFRESH_ROUTE } from '../decorators/jwt-refresh.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    // Refresh-token routes are authenticated by the jwt-refresh strategy, not
    // the access-token strategy this guard implements.
    const isRefreshRoute = this.reflector.getAllAndOverride<boolean>(IS_JWT_REFRESH_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isRefreshRoute) return true;
    return super.canActivate(context);
  }
}
