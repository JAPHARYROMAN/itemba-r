import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePermissionDto } from './dto/create-permission.dto';

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.permission.findMany({ orderBy: { code: 'asc' } });
  }

  findOne(id: string) {
    return this.prisma.permission.findUniqueOrThrow({ where: { id } });
  }

  create(dto: CreatePermissionDto) {
    return this.prisma.permission.create({ data: dto });
  }

  remove(id: string) {
    return this.prisma.permission.delete({ where: { id } });
  }
}
