import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateGuestDto } from './dto/create-guest.dto';
import { UpdateGuestDto } from './dto/update-guest.dto';
import { GuestStatus } from '@prisma/client';

@Injectable()
export class GuestsService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async create(dto: CreateGuestDto, userId: string) {
    const existing = await this.prisma.guest.findFirst({
      where: { companyId: dto.companyId, guestCode: dto.guestCode, deletedAt: null },
    });
    if (existing) throw new BadRequestException('Guest code already exists for this company');
    const guest = await this.prisma.guest.create({ data: dto });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'Guest', entityId: guest.id, newValue: dto as unknown as Record<string, unknown> });
    return guest;
  }

  async findAll(companyId?: string, status?: GuestStatus, search?: string, page = 1, limit = 20) {
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    if (status) where.status = status;
    if (search) where.OR = [
      { fullName: { contains: search, mode: 'insensitive' } },
      { guestCode: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
    const [data, total] = await this.prisma.$transaction([
      this.prisma.guest.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.guest.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const guest = await this.prisma.guest.findFirst({ where: { id, deletedAt: null } });
    if (!guest) throw new NotFoundException('Guest not found');
    return guest;
  }

  async update(id: string, dto: UpdateGuestDto, userId: string) {
    await this.findOne(id);
    const guest = await this.prisma.guest.update({ where: { id }, data: dto });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'Guest', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return guest;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.guest.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'Guest', entityId: id, newValue: {} });
    return { message: 'Guest deleted' };
  }
}
