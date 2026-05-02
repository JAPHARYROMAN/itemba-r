import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateMobileMoneyAccountDto } from './dto/create-mobile-money-account.dto';
import { UpdateMobileMoneyAccountDto } from './dto/update-mobile-money-account.dto';

/**
 * Normalise any Tanzanian MSISDN format to canonical E.164 (`+2557XXXXXXXX`).
 * Storage in one shape removes ambiguity for downstream provider integrations
 * (M-Pesa B2C, Tigo Pesa, etc.) which all accept E.164.
 */
function normaliseMsisdn(input: string): string {
  const digits = input.replace(/[^\d]/g, '');
  if (digits.startsWith('255')) return '+' + digits;
  if (digits.startsWith('0')) return '+255' + digits.substring(1);
  return '+' + digits;
}

@Injectable()
export class MobileMoneyAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async findByEmployee(employeeId: string) {
    return this.prisma.mobileMoneyAccount.findMany({
      where: { employeeId, deletedAt: null },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(id: string) {
    const row = await this.prisma.mobileMoneyAccount.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Mobile money account not found');
    return row;
  }

  async create(dto: CreateMobileMoneyAccountDto, userId: string) {
    const msisdn = normaliseMsisdn(dto.msisdn);

    // If primary requested, demote any existing primary for this employee.
    if (dto.isPrimary) {
      await this.prisma.mobileMoneyAccount.updateMany({
        where: { employeeId: dto.employeeId, isPrimary: true, deletedAt: null },
        data: { isPrimary: false },
      });
    }

    const row = await this.prisma.mobileMoneyAccount.create({
      data: {
        employeeId: dto.employeeId,
        provider: dto.provider,
        msisdn,
        accountName: dto.accountName,
        isPrimary: dto.isPrimary ?? false,
        status: dto.status ?? 'ACTIVE',
        notes: dto.notes,
      },
    });

    await this.audit.log({
      userId,
      action: 'CREATE',
      entityType: 'MobileMoneyAccount',
      entityId: row.id,
      newValue: row as unknown as Record<string, unknown>,
    });
    return row;
  }

  async update(id: string, dto: UpdateMobileMoneyAccountDto, userId: string) {
    const existing = await this.findOne(id);

    if (dto.isPrimary === true) {
      await this.prisma.mobileMoneyAccount.updateMany({
        where: { employeeId: existing.employeeId, isPrimary: true, NOT: { id }, deletedAt: null },
        data: { isPrimary: false },
      });
    }

    const data: Record<string, unknown> = {};
    if (dto.provider !== undefined) data.provider = dto.provider;
    if (dto.msisdn !== undefined) data.msisdn = normaliseMsisdn(dto.msisdn);
    if (dto.accountName !== undefined) data.accountName = dto.accountName;
    if (dto.isPrimary !== undefined) data.isPrimary = dto.isPrimary;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.notes !== undefined) data.notes = dto.notes;

    const row = await this.prisma.mobileMoneyAccount.update({ where: { id }, data });

    await this.audit.log({
      userId,
      action: 'UPDATE',
      entityType: 'MobileMoneyAccount',
      entityId: id,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: row as unknown as Record<string, unknown>,
    });
    return row;
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id);
    if (existing.isPrimary) {
      throw new BadRequestException(
        'Cannot delete the primary mobile money account. Promote another account first.',
      );
    }
    await this.prisma.mobileMoneyAccount.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'CLOSED' },
    });
    await this.audit.log({
      userId,
      action: 'DELETE',
      entityType: 'MobileMoneyAccount',
      entityId: id,
      oldValue: existing as unknown as Record<string, unknown>,
    });
    return { success: true };
  }
}
