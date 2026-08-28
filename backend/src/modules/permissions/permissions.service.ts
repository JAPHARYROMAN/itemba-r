import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class PermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  findAll() {
    return this.prisma.permission.findMany({ orderBy: { code: 'asc' } });
  }

  findOne(id: string) {
    return this.prisma.permission.findUniqueOrThrow({ where: { id } });
  }

  async create(dto: CreatePermissionDto, user: AuthUser) {
    const permission = await this.prisma.permission.create({ data: dto });
    await this.audit.log({
      action: 'PERMISSION_CREATE',
      entityType: 'Permission',
      entityId: permission.id,
      userId: user.id,
      companyId: null,
      newValue: permission as unknown as Record<string, unknown>,
    });
    return permission;
  }

  async remove(id: string, user: AuthUser) {
    const permission = await this.prisma.permission.delete({ where: { id } });
    await this.audit.log({
      action: 'PERMISSION_DELETE',
      entityType: 'Permission',
      entityId: id,
      userId: user.id,
      companyId: null,
      oldValue: permission as unknown as Record<string, unknown>,
    });
    return permission;
  }
}
