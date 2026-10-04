import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  MOBILE_POS_SESSION_ROLES,
  MobilePosRole,
} from '../decorators/mobile-pos-session.decorator';
import { AuthUser } from '../decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MobilePosSessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthUser; method?: string; path?: string }>();
    const user = request.user;
    if (!user) return true;
    const allowed = this.reflector.getAllAndOverride<MobilePosRole[]>(MOBILE_POS_SESSION_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (user.tokenUse === 'mobile-pos') {
      if (!user.mobilePosRole || !allowed?.includes(user.mobilePosRole)) {
        throw new ForbiddenException('This device session cannot access that operation');
      }
      return true;
    }
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method ?? 'GET')) return true;
    // Existing OS staff accounts and historical assignments cannot switch to a
    // password session to escape the approval boundary. Pausing or revoking the
    // enrollment also cannot restore direct ERP mutation rights.
    const enrollment = await this.prisma.mobilePosEnrollment.findFirst({
      where: {
        userId: user.id,
        approvedRole: { in: ['CASHIER', 'STOCKIST'] },
        approvedAt: { not: null },
      },
      include: { branchSetup: true },
      orderBy: { approvedAt: 'desc' },
    });
    let role = enrollment?.approvedRole as 'CASHIER' | 'STOCKIST' | undefined;
    if (
      !enrollment &&
      !user.permissions.includes('mobile_pos_lite.manage') &&
      !user.permissions.includes('mobile_pos_onboarding.manage')
    ) {
      const terminals = await this.prisma.mobilePosTerminal.findMany({
        where: { assignedUserId: user.id },
        select: { branchId: true },
      });
      if (
        terminals.length &&
        (await this.prisma.mobilePosBranchSetup.findFirst({
          where: { branchId: { in: [...new Set(terminals.map((terminal) => terminal.branchId))] } },
          select: { id: true },
        }))
      )
        role = user.roles.some((name) => /STOCKIST|STORE_KEEPER/.test(name))
          ? 'STOCKIST'
          : 'CASHIER';
    }
    if (!role) return true;
    if (/^\/(?:api\/v\d+\/)?auth\/logout\/?$/.test(request.path ?? '')) return true;
    if (
      !enrollment ||
      enrollment.status !== 'APPROVED' ||
      !enrollment.branchSetup.enabled ||
      !enrollment.branchSetup.approvalRequired ||
      !allowed?.includes(role)
    ) {
      throw new ForbiddenException('This device session cannot access that operation');
    }
    // Authoritative role for an allowlisted capture handler; client scope cannot
    // fall back to an administrator interpretation on another branch.
    user.mobilePosRole = role;
    return true;
  }
}
