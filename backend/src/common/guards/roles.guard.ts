import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthUser } from '../decorators/current-user.decorator';
import { AuditLogsService } from '../../modules/audit-logs/audit-logs.service';
import { auditSensitiveAccessDenial } from '../policies/sensitive-access-audit';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditLogsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) {
      const error = new ForbiddenException('Authentication required');
      await auditSensitiveAccessDenial(this.reflector, this.audit, context, {
        stage: 'role',
        statusCode: error.getStatus(),
        reason: error.message,
        requiredRoles: required,
      });
      throw error;
    }

    const ok = required.some((r) => user.roles.includes(r));
    if (!ok) {
      const error = new ForbiddenException('Insufficient role');
      await auditSensitiveAccessDenial(this.reflector, this.audit, context, {
        stage: 'role',
        statusCode: error.getStatus(),
        reason: error.message,
        requiredRoles: required,
      });
      throw error;
    }
    return true;
  }
}
