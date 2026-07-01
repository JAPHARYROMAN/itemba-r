import { Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateTaxReturnDto } from './dto/create-tax-return.dto';
import { UpdateTaxReturnDto } from './dto/update-tax-return.dto';
import { applyCompanyScopeWhere, CompanyScopeService } from '../../../common/services';
import { AuthUser } from '../../../common/decorators/current-user.decorator';

@Injectable()
export class TaxReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  /**
   * Load a tax return by id, scoped to the caller's FULL accessible-company set
   * (primary company + explicit companyAccess grants + group scope), NOT just
   * their single primary company. This mirrors the receivables/approval-requests
   * canonical pattern: fetch by id (soft-delete filter only), then
   * assertCanAccessCompany at the requested level. Throwing NotFound on a
   * genuinely-foreign tenant avoids leaking the record's existence, while a
   * legitimate multi-company/group user no longer gets a false 404 on records
   * belonging to another company they can access.
   */
  private async loadScoped(id: string, user: AuthUser, minimum: AccessLevel) {
    const record = await this.prisma.taxReturn.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Tax return not found');
    try {
      await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    } catch {
      throw new NotFoundException('Tax return not found');
    }
    return record;
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, taxTypeId, status } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (taxTypeId) where.taxTypeId = taxTypeId;
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.taxReturn.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.taxReturn.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    return this.loadScoped(id, user, AccessLevel.READ);
  }

  async create(dto: CreateTaxReturnDto, user: any) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.MANAGE);
    const record = await this.prisma.taxReturn.create({ data: { ...dto } as any });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'TaxReturn', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdateTaxReturnDto, user: any) {
    // WRITE-scoped against the caller's FULL accessible-company set (loadScoped),
    // so multi-company/group users can mutate records they legitimately reach.
    await this.loadScoped(id, user, AccessLevel.WRITE);
    // companyId is immutable: never allow a client-supplied companyId to move the row to another company.
    const { companyId: _ignoredCompanyId, ...data } = dto as any;
    const record = await this.prisma.taxReturn.update({ where: { id }, data: data as any });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'TaxReturn', entityId: id, newValue: data as unknown as Record<string, unknown> });
    return record;
  }

  async prepare(id: string, user: any) {
    await this.loadScoped(id, user, AccessLevel.WRITE);
    const record = await this.prisma.taxReturn.update({ where: { id }, data: { status: 'PREPARED' as any, preparedById: user.id } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'TaxReturn', entityId: id, newValue: { status: 'PREPARED' } });
    return record;
  }

  async review(id: string, user: any) {
    await this.loadScoped(id, user, AccessLevel.WRITE);
    const record = await this.prisma.taxReturn.update({ where: { id }, data: { status: 'REVIEWED' as any, reviewedById: user.id } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'TaxReturn', entityId: id, newValue: { status: 'REVIEWED' } });
    return record;
  }

  async approve(id: string, user: any) {
    await this.loadScoped(id, user, AccessLevel.WRITE);
    const record = await this.prisma.taxReturn.update({ where: { id }, data: { status: 'APPROVED' as any, approvedById: user.id } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'TaxReturn', entityId: id, newValue: { status: 'APPROVED' } });
    return record;
  }

  async submit(id: string, user: any) {
    await this.loadScoped(id, user, AccessLevel.WRITE);
    const record = await this.prisma.taxReturn.update({ where: { id }, data: { status: 'SUBMITTED' as any, submittedById: user.id, submissionDate: new Date() } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'TaxReturn', entityId: id, newValue: { status: 'SUBMITTED' } });
    return record;
  }

  async markPaid(id: string, user: any) {
    await this.loadScoped(id, user, AccessLevel.WRITE);
    const record = await this.prisma.taxReturn.update({ where: { id }, data: { status: 'PAID' as any, paidById: user.id, paymentDate: new Date() } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'TaxReturn', entityId: id, newValue: { status: 'PAID' } });
    return record;
  }

  async cancel(id: string, user: any) {
    await this.loadScoped(id, user, AccessLevel.WRITE);
    const record = await this.prisma.taxReturn.update({ where: { id }, data: { status: 'CANCELLED' as any } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'TaxReturn', entityId: id, newValue: { status: 'CANCELLED' } });
    return record;
  }

  async remove(id: string, user: any) {
    await this.loadScoped(id, user, AccessLevel.WRITE);
    await this.prisma.taxReturn.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'TaxReturn', entityId: id, newValue: {} });
    return { message: 'Tax return deleted' };
  }
}
