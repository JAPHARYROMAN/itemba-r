import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { RECENT_AUTH_KEY } from '../decorators/recent-auth.decorator';

@Injectable()
export class RecentAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const windowMinutes = this.reflector.getAllAndOverride<number | undefined>(
      RECENT_AUTH_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Guard is a no-op if decorator not present
    if (windowMinutes === undefined) return true;

    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.user?.id;

    if (!userId) throw new ForbiddenException('Authentication required');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { lastPasswordVerifiedAt: true },
    });

    if (!user?.lastPasswordVerifiedAt) {
      throw new ForbiddenException(
        'This action requires recent authentication. Please verify your password first.',
      );
    }

    const windowMs = windowMinutes * 60_000;
    const elapsed = Date.now() - user.lastPasswordVerifiedAt.getTime();

    if (elapsed > windowMs) {
      throw new ForbiddenException(
        `This action requires authentication within the last ${windowMinutes} minutes. Please verify your password again.`,
      );
    }

    return true;
  }
}
