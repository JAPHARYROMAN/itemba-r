import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

const KNOWN_ENV_KEYS: Array<{ key: string; required: boolean }> = [
  { key: 'DATABASE_URL', required: true },
  { key: 'JWT_ACCESS_SECRET', required: true },
  { key: 'JWT_REFRESH_SECRET', required: true },
  { key: 'APP_SECRET', required: true },
  { key: 'NODE_ENV', required: true },
  { key: 'PORT', required: false },
  { key: 'SMTP_HOST', required: false },
  { key: 'SMTP_PORT', required: false },
  { key: 'AWS_S3_BUCKET', required: false },
  { key: 'THROTTLE_TTL', required: false },
  { key: 'THROTTLE_LIMIT', required: false },
];

function maskValue(value: string): string {
  if (!value || value.length <= 4) return '****';
  return value.substring(0, 2) + '****' + value.substring(value.length - 2);
}

function isValidEnvKey(key: string, value: string | undefined): boolean {
  if (!value) return false;
  if (key === 'NODE_ENV') return ['development', 'production', 'test', 'staging'].includes(value);
  if (key === 'PORT') return !isNaN(Number(value));
  if (key === 'SMTP_PORT') return !isNaN(Number(value));
  if (key === 'THROTTLE_TTL') return !isNaN(Number(value));
  if (key === 'THROTTLE_LIMIT') return !isNaN(Number(value));
  return value.length > 0;
}

@Injectable()
export class EnvironmentConfigChecksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any) {
    const { page = 1, limit = 20, category, status } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    if (category) where.category = category;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.environmentConfigCheck.findMany({ where, skip, take: Number(limit), orderBy: { configKey: 'asc' } }),
      this.prisma.environmentConfigCheck.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma.environmentConfigCheck.findFirst({ where: { id } });
    if (!record) throw new NotFoundException('Environment config check not found');
    return record;
  }

  async create(dto: any, userId: string) {
    const record = await this.prisma.environmentConfigCheck.create({
      data: {
        configKey: dto.configKey,
        category: dto.category,
        description: dto.description,
        required: dto.required ?? false,
        present: false,
        valid: false,
        status: 'UNKNOWN',
        lastCheckedAt: new Date(),
      },
    });
    await this.auditLogs.log({ action: 'ENV_CONFIG_CHECK_CREATED', entityType: 'EnvironmentConfigCheck', entityId: record.id, userId, severity: AuditSeverity.LOW });
    return record;
  }

  async update(id: string, dto: any, userId: string) {
    await this.findOne(id);
    const record = await this.prisma.environmentConfigCheck.update({
      where: { id },
      data: {
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.required !== undefined && { required: dto.required }),
        ...(dto.category !== undefined && { category: dto.category }),
      },
    });
    return record;
  }

  async runChecks(userId: string) {
    const now = new Date();
    const results: any[] = [];

    for (const envDef of KNOWN_ENV_KEYS) {
      const rawValue = process.env[envDef.key];
      const present = rawValue !== undefined && rawValue !== '';
      const valid = isValidEnvKey(envDef.key, rawValue);
      const status = present && valid ? 'PASS' : present && !valid ? 'WARNING' : envDef.required ? 'FAIL' : 'WARNING';

      const existing = await this.prisma.environmentConfigCheck.findFirst({ where: { configKey: envDef.key } });
      if (existing) {
        const updated = await this.prisma.environmentConfigCheck.update({
          where: { id: existing.id },
          data: { present, valid, valueMasked: present ? maskValue(rawValue!) : null, status: status as any, lastCheckedAt: now },
        });
        results.push(updated);
      } else {
        const created = await this.prisma.environmentConfigCheck.create({
          data: {
            configKey: envDef.key,
            category: 'GENERAL' as any,
            description: `Environment variable ${envDef.key}`,
            required: envDef.required,
            present,
            valid,
            valueMasked: present ? maskValue(rawValue!) : null,
            status: status as any,
            lastCheckedAt: now,
          },
        });
        results.push(created);
      }
    }

    await this.auditLogs.log({ action: 'ENV_CONFIG_CHECKS_RUN', entityType: 'EnvironmentConfigCheck', userId, metadata: { checked: results.length }, severity: AuditSeverity.MEDIUM });
    return { checked: results.length, results };
  }
}
