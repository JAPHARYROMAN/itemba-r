import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ApiKeyStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { API_SCOPE_KEY } from '../decorators/require-api-scope.decorator';
import { hashApiKey, legacyHashApiKey } from '../utils/api-key-hash';

/**
 * Authenticates a request via an `x-api-key` header.
 *
 * - The key is hashed with a server-peppered HMAC and looked up against `ApiKey.keyHash`.
 * - The key must be ACTIVE, not expired, and not revoked.
 * - When `@RequireApiScope(...)` is set on the route, every declared scope must
 *   be present in `apiKey.scopes` (AND semantics).
 *
 * On success, the request is decorated with:
 *   req.apiKey  — the authenticated ApiKey row + apiClient info.
 *   req.user    — a synthetic AuthUser-shaped object so downstream guards keep working.
 */
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req: any = context.switchToHttp().getRequest();
    const headerKey =
      (req.headers['x-api-key'] as string | undefined) ??
      (req.headers['X-API-Key'] as string | undefined);
    if (!headerKey) {
      throw new UnauthorizedException('Missing x-api-key header');
    }

    const keyPepper = this.config.getOrThrow<string>('APP_ENCRYPTION_KEY');
    const keyHash = hashApiKey(headerKey, keyPepper);
    const legacyHash = legacyHashApiKey(headerKey);
    let apiKey = await this.prisma.apiKey.findFirst({
      where: { keyHash, deletedAt: null },
      include: { apiClient: { select: { id: true, companyId: true, name: true } } },
    });
    if (!apiKey) {
      apiKey = await this.prisma.apiKey.findFirst({
        where: { keyHash: legacyHash, deletedAt: null },
        include: { apiClient: { select: { id: true, companyId: true, name: true } } },
      });
    }

    if (!apiKey) throw new UnauthorizedException('Invalid API key');
    if (apiKey.status !== ApiKeyStatus.ACTIVE || apiKey.revokedAt) {
      throw new UnauthorizedException('API key is not active');
    }
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw new UnauthorizedException('API key has expired');
    }

    const requiredScopes =
      this.reflector.getAllAndOverride<string[] | undefined>(API_SCOPE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (requiredScopes.length > 0) {
      const granted = Array.isArray(apiKey.scopes) ? (apiKey.scopes as string[]) : [];
      const missing = requiredScopes.filter((s) => !granted.includes(s));
      if (missing.length > 0) {
        throw new ForbiddenException(`API key is missing required scope(s): ${missing.join(', ')}`);
      }
    }

    // Best-effort lastUsedAt update — never block the request on this.
    this.prisma.apiKey
      .update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date(), ...(apiKey.keyHash === legacyHash && { keyHash }) },
      })
      .catch(() => undefined);

    req.apiKey = apiKey;
    req.user = {
      id: apiKey.apiClient.id,
      email: `apikey:${apiKey.apiKeyCode}`,
      fullName: apiKey.apiClient.name,
      roles: ['API_CLIENT'],
      roleScopes: [],
      permissions: [],
      companyId: apiKey.apiClient.companyId ?? null,
    };

    return true;
  }
}
