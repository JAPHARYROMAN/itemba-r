import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MsaidiziPrincipalStatus, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MsaidiziPrincipalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  get autopilotEnabled(): boolean {
    return this.config.get<string>('MSAIDIZI_AUTOPILOT_ENABLED', 'false').toLowerCase() === 'true';
  }

  findGlobal() {
    return this.prisma.msaidiziPrincipal.findUnique({ where: { key: this.principalKey } });
  }

  async resolveGlobal(user: AuthUser) {
    const permissions = Array.from(
      new Set(
        this.config
          .get<string>('MSAIDIZI_AUTONOMY_GRANTS', '')
          .split(',')
          .map((permission) => permission.trim())
          .filter(Boolean),
      ),
    );
    const grants: Prisma.InputJsonObject = {
      scope: 'GROUP',
      authoritySource: 'deployment-policy',
      permissions,
    };
    const principal = await this.prisma.msaidiziPrincipal.upsert({
      where: { key: this.principalKey },
      update: { grants },
      create: {
        key: this.principalKey,
        displayName: 'Msaidizi',
        grants,
        createdByUserId: user.id,
      },
    });
    if (principal.status !== MsaidiziPrincipalStatus.ACTIVE) {
      throw new ConflictException('The global Msaidizi principal is not active');
    }
    return principal;
  }

  private get principalKey(): string {
    return this.config.get<string>('MSAIDIZI_AUTONOMY_PRINCIPAL_KEY', 'global-msaidizi');
  }
}
