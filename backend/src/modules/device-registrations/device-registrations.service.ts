import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AuditSeverity, DeviceStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateDeviceRegistrationDto } from './dto/create-device-registration.dto';
import { UpdateDeviceRegistrationDto } from './dto/update-device-registration.dto';
import { QueryDeviceRegistrationDto } from './dto/query-device-registration.dto';

const SAFE_SELECT = {
  id: true,
  deviceCode: true,
  userId: true,
  employeeId: true,
  companyId: true,
  deviceName: true,
  deviceType: true,
  platform: true,
  appVersion: true,
  deviceIdentifierHash: true,
  status: true,
  lastSeenAt: true,
  registeredAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
};

@Injectable()
export class DeviceRegistrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: QueryDeviceRegistrationDto) {
    const { page = 1, limit = 20, userId, companyId, deviceType, status } = query;
    const skip = (page - 1) * limit;
    const where: any = { deletedAt: null };
    if (userId) where.userId = userId;
    if (companyId) where.companyId = companyId;
    if (deviceType) where.deviceType = deviceType;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.deviceRegistration.findMany({
        where,
        select: SAFE_SELECT,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.deviceRegistration.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma.deviceRegistration.findFirst({
      where: { id, deletedAt: null },
      select: SAFE_SELECT,
    });
    if (!record) throw new NotFoundException('Device registration not found');
    return record;
  }

  async create(dto: CreateDeviceRegistrationDto, userId: string) {
    const existing = await this.prisma.deviceRegistration.findFirst({
      where: { deviceCode: dto.deviceCode, deletedAt: null },
    });
    if (existing) throw new BadRequestException(`Device code "${dto.deviceCode}" already exists`);

    const record = await this.prisma.deviceRegistration.create({
      data: {
        deviceCode: dto.deviceCode,
        userId: dto.userId,
        employeeId: dto.employeeId,
        companyId: dto.companyId,
        deviceName: dto.deviceName,
        deviceType: dto.deviceType,
        platform: dto.platform,
        appVersion: dto.appVersion,
        deviceIdentifierHash: dto.deviceIdentifierHash,
        status: dto.status,
      },
      select: SAFE_SELECT,
    });

    await this.auditLogs.log({
      action: 'DEVICE_REGISTRATION_CREATED',
      entityType: 'DeviceRegistration',
      entityId: record.id,
      userId,
      newValue: record as any,
      severity: AuditSeverity.LOW,
    });

    return record;
  }

  async update(id: string, dto: UpdateDeviceRegistrationDto, userId: string) {
    await this.findOneRaw(id);
    const record = await this.prisma.deviceRegistration.update({
      where: { id },
      data: {
        ...(dto.deviceName !== undefined && { deviceName: dto.deviceName }),
        ...(dto.appVersion !== undefined && { appVersion: dto.appVersion }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.platform !== undefined && { platform: dto.platform }),
        ...(dto.deviceType !== undefined && { deviceType: dto.deviceType }),
      },
      select: SAFE_SELECT,
    });

    await this.auditLogs.log({
      action: 'DEVICE_REGISTRATION_UPDATED',
      entityType: 'DeviceRegistration',
      entityId: id,
      userId,
      severity: AuditSeverity.LOW,
    });

    return record;
  }

  async block(id: string, userId: string) {
    await this.findOneRaw(id);
    const record = await this.prisma.deviceRegistration.update({
      where: { id },
      data: { status: DeviceStatus.BLOCKED },
      select: SAFE_SELECT,
    });

    await this.auditLogs.log({
      action: 'DEVICE_BLOCKED',
      entityType: 'DeviceRegistration',
      entityId: id,
      userId,
      severity: AuditSeverity.HIGH,
    });

    return record;
  }

  async revoke(id: string, userId: string) {
    await this.findOneRaw(id);
    const record = await this.prisma.deviceRegistration.update({
      where: { id },
      data: { status: DeviceStatus.REVOKED, deletedAt: new Date() },
      select: SAFE_SELECT,
    });

    await this.auditLogs.log({
      action: 'DEVICE_REVOKED',
      entityType: 'DeviceRegistration',
      entityId: id,
      userId,
      severity: AuditSeverity.HIGH,
    });

    return record;
  }

  private async findOneRaw(id: string) {
    const record = await this.prisma.deviceRegistration.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Device registration not found');
    return record;
  }
}
