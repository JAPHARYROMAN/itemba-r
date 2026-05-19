import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateHrDocumentDto } from './dto/create-hr-document.dto';
import { UpdateHrDocumentDto } from './dto/update-hr-document.dto';
import { applyCompanyScopeWhere } from '../../../common/services';

@Injectable()
export class HrDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  /**
   * Fields selected from the linked Document — only the operator-visible
   * metadata. The storage key, raw mime, and confidential flag stay on the
   * Document model and are accessed via the Documents Vault directly.
   */
  private readonly documentSelect = {
    id: true,
    title: true,
    fileName: true,
    fileSizeBytes: true,
    mimeType: true,
    expiryDate: true,
    renewalDate: true,
    status: true,
    version: true,
  } as const;

  async findAll(user: any, query: any) {
    const {
      page = 1,
      limit = 20,
      employeeId,
      companyId,
      divisionId,
      branchId,
      documentCategory,
    } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (employeeId) where.employeeId = employeeId;
    if (documentCategory) where.documentCategory = documentCategory;
    const [data, total] = await Promise.all([
      this.prisma.hRDocument.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          employee: { select: { id: true, fullName: true, employeeCode: true } },
          company: { select: { id: true, name: true } },
          division: { select: { id: true, name: true, code: true } },
          branch: { select: { id: true, name: true, code: true } },
          document: { select: this.documentSelect },
        },
      }),
      this.prisma.hRDocument.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.hRDocument.findFirst({
      where: { id, deletedAt: null, ...this.companyFilter(user) },
      include: {
        employee: { select: { id: true, fullName: true, employeeCode: true } },
        company: { select: { id: true, name: true } },
        division: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
        document: { select: this.documentSelect },
      },
    });
    if (!record) throw new NotFoundException('HR document not found');
    return record;
  }

  async create(dto: CreateHrDocumentDto, user: any) {
    const hierarchy = await this.resolveHrDocumentHierarchy(
      dto.companyId,
      dto.employeeId,
      dto.divisionId,
      dto.branchId,
    );
    const record = await this.prisma.hRDocument.create({
      data: { ...dto, divisionId: hierarchy.divisionId, branchId: hierarchy.branchId } as any,
    });
    await this.audit.log({
      userId: user.id,
      action: 'DOCUMENT_UPLOAD',
      entityType: 'HRDocument',
      entityId: record.id,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return record;
  }

  async update(id: string, dto: UpdateHrDocumentDto, user: any) {
    const existing = await this.findOne(id, user);
    const hierarchy =
      (dto as any).companyId !== undefined ||
      dto.employeeId !== undefined ||
      dto.divisionId !== undefined ||
      dto.branchId !== undefined
        ? await this.resolveHrDocumentHierarchy(
            (dto as any).companyId ?? existing.companyId,
            dto.employeeId ?? existing.employeeId ?? undefined,
            dto.divisionId ?? existing.divisionId ?? undefined,
            dto.branchId ?? existing.branchId ?? undefined,
          )
        : { divisionId: existing.divisionId, branchId: existing.branchId };
    const record = await this.prisma.hRDocument.update({
      where: { id },
      data: { ...dto, divisionId: hierarchy.divisionId, branchId: hierarchy.branchId } as any,
    });
    await this.audit.log({
      userId: user.id,
      action: 'DOCUMENT_UPDATE',
      entityType: 'HRDocument',
      entityId: id,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.hRDocument.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId: user.id,
      action: 'DOCUMENT_DELETE',
      entityType: 'HRDocument',
      entityId: id,
      newValue: {},
    });
    return { message: 'HR document deleted' };
  }

  private async resolveHrDocumentHierarchy(
    companyId: string,
    employeeId?: string,
    requestedDivisionId?: string | null,
    requestedBranchId?: string | null,
  ) {
    let employeeHierarchy: { divisionId: string | null; branchId: string | null } = {
      divisionId: null,
      branchId: null,
    };
    if (employeeId) {
      const employee = await this.prisma.employee.findFirst({
        where: { id: employeeId, companyId, deletedAt: null },
        select: { divisionId: true, branchId: true },
      });
      if (!employee) throw new BadRequestException('Employee does not belong to this company');
      employeeHierarchy = employee;
    }

    const divisionId = requestedDivisionId ?? employeeHierarchy.divisionId;
    const branchId = requestedBranchId ?? employeeHierarchy.branchId;
    await this.assertHierarchyBelongsToCompany(companyId, divisionId, branchId);
    return { divisionId, branchId };
  }

  private async assertHierarchyBelongsToCompany(
    companyId: string,
    divisionId?: string | null,
    branchId?: string | null,
  ) {
    if (divisionId) {
      const division = await this.prisma.division.findFirst({
        where: { id: divisionId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!division) throw new BadRequestException('Division does not belong to this company');
    }
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: {
          id: branchId,
          deletedAt: null,
          division: { companyId },
          ...(divisionId ? { divisionId } : {}),
        },
        select: { id: true },
      });
      if (!branch) throw new BadRequestException('Branch does not belong to this company/division');
    }
  }
}
