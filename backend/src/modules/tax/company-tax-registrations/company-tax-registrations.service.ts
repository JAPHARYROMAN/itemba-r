import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateCompanyTaxRegistrationDto } from './dto/create-company-tax-registration.dto';
import { UpdateCompanyTaxRegistrationDto } from './dto/update-company-tax-registration.dto';
import { applyCompanyScopeWhere } from '../../../common/services';

@Injectable()
export class CompanyTaxRegistrationsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, status, registrationType } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (status) where.status = status;
    if (registrationType) where.registrationType = registrationType;
    const [data, total] = await Promise.all([
      this.prisma.companyTaxRegistration.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.companyTaxRegistration.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findByCompany(companyId: string, user: any) {
    const where: any = { deletedAt: null, companyId, ...this.companyFilter(user) };
    return this.prisma.companyTaxRegistration.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.companyTaxRegistration.findFirst({ where: { id, deletedAt: null, ...this.companyFilter(user) } });
    if (!record) throw new NotFoundException('Company tax registration not found');
    return record;
  }

  async create(dto: CreateCompanyTaxRegistrationDto, user: any) {
    const record = await this.prisma.companyTaxRegistration.create({ data: { ...dto } as any });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'CompanyTaxRegistration', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdateCompanyTaxRegistrationDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.companyTaxRegistration.update({ where: { id }, data: dto as any });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'CompanyTaxRegistration', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.companyTaxRegistration.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'CompanyTaxRegistration', entityId: id, newValue: {} });
    return { message: 'Company tax registration deleted' };
  }
}
