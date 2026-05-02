import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.group.findMany({ include: { companies: true }, orderBy: { name: 'asc' } });
  }

  findOne(id: string) {
    return this.prisma.group.findUniqueOrThrow({
      where: { id },
      include: { companies: { include: { divisions: true } } },
    });
  }

  create(dto: CreateGroupDto) {
    return this.prisma.group.create({ data: dto });
  }
  update(id: string, dto: UpdateGroupDto) {
    return this.prisma.group.update({ where: { id }, data: dto });
  }
  remove(id: string) {
    return this.prisma.group.delete({ where: { id } });
  }
}
