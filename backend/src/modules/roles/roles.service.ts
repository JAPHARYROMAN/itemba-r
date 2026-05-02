import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all roles with their permissions and per-role counts the UI uses to
   * render assignment summaries (how many users currently hold the role and
   * how many permissions the role grants).
   */
  findAll() {
    return this.prisma.role.findMany({
      include: {
        rolePermissions: { include: { permission: true } },
        _count: { select: { userRoles: true, rolePermissions: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  findOne(id: string) {
    return this.prisma.role.findUniqueOrThrow({
      where: { id },
      include: {
        rolePermissions: { include: { permission: true } },
        _count: { select: { userRoles: true, rolePermissions: true } },
      },
    });
  }

  create(dto: CreateRoleDto) {
    return this.prisma.role.create({
      data: {
        name: dto.name,
        displayName: dto.displayName,
        description: dto.description,
        scope: dto.scope,
        rolePermissions: dto.permissionIds
          ? { create: dto.permissionIds.map((pid) => ({ permissionId: pid })) }
          : undefined,
      },
    });
  }

  /**
   * Update role metadata and (optionally) replace its permission set.
   * Replacement is wrapped in a single transaction so a partial failure
   * doesn't leave the role with half-applied permissions.
   */
  async update(id: string, dto: UpdateRoleDto) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.permissionIds) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        if (dto.permissionIds.length > 0) {
          await tx.rolePermission.createMany({
            data: dto.permissionIds.map((pid) => ({ roleId: id, permissionId: pid })),
          });
        }
      }
      return tx.role.update({
        where: { id },
        data: {
          name: dto.name,
          displayName: dto.displayName,
          description: dto.description,
          scope: dto.scope,
        },
      });
    });
  }

  /**
   * Delete a role. Refuses on:
   *  - System roles (`isSystem: true`) — seeded baseline roles must never be
   *    removed via the API.
   *  - Roles still assigned to users — Prisma would Cascade-remove the
   *    UserRole rows and silently strip people of access. Force the caller to
   *    reassign first.
   */
  async remove(id: string) {
    const role = await this.prisma.role.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { userRoles: true } } },
    });
    if (role.isSystem) {
      throw new BadRequestException(
        `Role "${role.name}" is a system role and cannot be deleted.`,
      );
    }
    if (role._count.userRoles > 0) {
      throw new BadRequestException(
        `Role "${role.name}" is still assigned to ${role._count.userRoles} user(s). Reassign them before deleting.`,
      );
    }
    return this.prisma.role.delete({ where: { id } });
  }
}
