import { BadRequestException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { AccessLevel, DocumentCategory, DocumentOwnerType, DocumentStatus, Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateDocumentDto } from './dto/create-document.dto';
import { QueryDocumentDto } from './dto/query-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'documents');

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  /** Upload a file and create the Document record. */
  async upload(
    file: Express.Multer.File,
    dto: CreateDocumentDto,
    user: AuthUser,
    ipAddress?: string,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    const uploadedById = user.id;

    const storageKey = `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
    const destPath = path.join(UPLOADS_DIR, storageKey);

    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    fs.renameSync(file.path, destPath);

    const doc = await this.prisma.document.create({
      data: {
        title: dto.title,
        documentCode: dto.documentCode,
        category: dto.category ?? DocumentCategory.OTHER,
        ownerType: dto.ownerType,
        ownerId: dto.ownerId,
        fileName: file.originalname,
        storageKey,
        mimeType: file.mimetype,
        fileSizeBytes: file.size,
        description: dto.description,
        isConfidential: dto.isConfidential ?? false,
        status: dto.status ?? DocumentStatus.ACTIVE,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
        renewalDate: dto.renewalDate ? new Date(dto.renewalDate) : undefined,
        tags: dto.tags ?? [],
        groupId: dto.groupId,
        companyId: dto.companyId,
        divisionId: dto.divisionId,
        branchId: dto.branchId,
        bankAccountId: dto.bankAccountId,
        loanId: dto.loanId,
        debtId: dto.debtId,
        contractId: dto.contractId,
        fixedAssetId: dto.fixedAssetId,
        uploadedById,
      },
      include: { company: { select: { name: true } }, uploadedBy: { select: { fullName: true } } },
    });

    await this.auditLogs.log({
      action: 'DOCUMENT_UPLOAD',
      entityType: 'Document',
      entityId: doc.id,
      userId: uploadedById,
      companyId: dto.companyId,
      ipAddress,
      metadata: { title: doc.title, category: doc.category, isConfidential: doc.isConfidential },
    });

    return doc;
  }

  async findAll(query: QueryDocumentDto, user: AuthUser) {
    const {
      search,
      companyId,
      groupId,
      category,
      ownerType,
      status,
      isConfidential,
      expiringBefore,
      ownerId,
    } = query;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
    const where: Prisma.DocumentWhereInput = {
      deletedAt: null,
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { documentCode: { contains: search, mode: 'insensitive' } },
          { fileName: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(category && { category }),
      ...(ownerType && { ownerType }),
      ...(status && { status }),
      ...(isConfidential !== undefined && { isConfidential }),
      ...(expiringBefore && { expiryDate: { lte: new Date(expiringBefore) } }),
      ...(ownerId && { ownerId }),
    };

    if (companyId) {
      await this.companyScope.assertCanAccessCompany(user, companyId);
      where.companyId = companyId;
    } else if (accessibleIds !== null) {
      // Non-group-scoped users cannot see group-level (companyId null) documents.
      where.companyId = { in: accessibleIds };
    }
    if (groupId) where.groupId = groupId;

    const [data, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          company: { select: { name: true } },
          uploadedBy: { select: { fullName: true } },
        },
      }),
      this.prisma.document.count({ where }),
    ]);

    return { data, total, page, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: AuthUser, ipAddress?: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true } },
        division: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        loan: { select: { id: true, lenderName: true } },
        debt: { select: { id: true, creditorName: true } },
        contract: { select: { id: true, title: true } },
        fixedAsset: { select: { id: true, name: true } },
        uploadedBy: { select: { id: true, fullName: true } },
      },
    });
    if (!doc) throw new NotFoundException(`Document ${id} not found`);
    await this.companyScope.assertCanAccessCompany(user, doc.companyId);

    await this.auditLogs.log({
      action: 'DOCUMENT_VIEW',
      entityType: 'Document',
      entityId: id,
      userId: user.id,
      companyId: doc.companyId ?? undefined,
      ipAddress,
      metadata: { title: doc.title, isConfidential: doc.isConfidential },
    });

    return doc;
  }

  /** Stream file bytes for download. */
  async download(
    id: string,
    user: AuthUser,
    ipAddress?: string,
  ): Promise<StreamableFile & { doc: { fileName: string; mimeType: string } }> {
    const doc = await this.prisma.document.findFirst({ where: { id, deletedAt: null } });
    if (!doc) throw new NotFoundException(`Document ${id} not found`);
    await this.companyScope.assertCanAccessCompany(user, doc.companyId);

    const filePath = path.join(UPLOADS_DIR, doc.storageKey);
    if (!fs.existsSync(filePath)) throw new NotFoundException('File not found in storage');

    await this.auditLogs.log({
      action: 'DOCUMENT_DOWNLOAD',
      entityType: 'Document',
      entityId: id,
      userId: user.id,
      companyId: doc.companyId ?? undefined,
      ipAddress,
      metadata: { fileName: doc.fileName, isConfidential: doc.isConfidential },
    });

    const stream = fs.createReadStream(filePath);
    const sf = new StreamableFile(stream) as StreamableFile & {
      doc: { fileName: string; mimeType: string };
    };
    sf.doc = { fileName: doc.fileName, mimeType: doc.mimeType };
    return sf;
  }

  async update(id: string, dto: UpdateDocumentDto, user: AuthUser, ipAddress?: string) {
    const existing = await this.prisma.document.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException(`Document ${id} not found`);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.WRITE);
    const userId = user.id;

    const updated = await this.prisma.document.update({
      where: { id },
      data: {
        ...(dto.title && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.category && { category: dto.category }),
        ...(dto.status && { status: dto.status }),
        ...(dto.isConfidential !== undefined && { isConfidential: dto.isConfidential }),
        ...(dto.expiryDate !== undefined && {
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        }),
        ...(dto.renewalDate !== undefined && {
          renewalDate: dto.renewalDate ? new Date(dto.renewalDate) : null,
        }),
        ...(dto.tags && { tags: dto.tags }),
      },
    });

    await this.auditLogs.log({
      action: 'DOCUMENT_UPDATE',
      entityType: 'Document',
      entityId: id,
      userId,
      companyId: existing.companyId ?? undefined,
      ipAddress,
      oldValue: { title: existing.title, status: existing.status, category: existing.category },
      newValue: { title: updated.title, status: updated.status, category: updated.category },
    });

    return updated;
  }

  async remove(id: string, user: AuthUser, ipAddress?: string) {
    const existing = await this.prisma.document.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException(`Document ${id} not found`);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.MANAGE);
    const userId = user.id;

    const deleted = await this.prisma.document.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditLogs.log({
      action: 'DOCUMENT_DELETE',
      entityType: 'Document',
      entityId: id,
      userId,
      companyId: existing.companyId ?? undefined,
      ipAddress,
      metadata: { title: existing.title },
    });

    return deleted;
  }

  async getExpiring(user: AuthUser, days = 30, companyId?: string) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);
    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
    const where: Prisma.DocumentWhereInput = {
      deletedAt: null,
      status: { notIn: [DocumentStatus.ARCHIVED, DocumentStatus.SUPERSEDED] },
      expiryDate: { gte: new Date(), lte: cutoff },
    };
    if (companyId) {
      await this.companyScope.assertCanAccessCompany(user, companyId);
      where.companyId = companyId;
    } else if (accessibleIds !== null) {
      where.companyId = { in: accessibleIds };
    }

    return this.prisma.document.findMany({
      where,
      orderBy: { expiryDate: 'asc' },
      include: { company: { select: { name: true } } },
    });
  }

  async getSummary(user: AuthUser, companyId?: string) {
    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
    const baseWhere: Prisma.DocumentWhereInput = { deletedAt: null };
    if (companyId) {
      await this.companyScope.assertCanAccessCompany(user, companyId);
      baseWhere.companyId = companyId;
    } else if (accessibleIds !== null) {
      baseWhere.companyId = { in: accessibleIds };
    }
    const now = new Date();
    const in30Days = new Date();
    in30Days.setDate(now.getDate() + 30);

    const [total, confidential, expired, expiringSoon, byCategory, byStatus] = await Promise.all([
      this.prisma.document.count({ where: baseWhere }),
      this.prisma.document.count({ where: { ...baseWhere, isConfidential: true } }),
      this.prisma.document.count({ where: { ...baseWhere, expiryDate: { lt: now } } }),
      this.prisma.document.count({
        where: { ...baseWhere, expiryDate: { gte: now, lte: in30Days } },
      }),
      this.prisma.document.groupBy({ by: ['category'], where: baseWhere, _count: { id: true } }),
      this.prisma.document.groupBy({ by: ['status'], where: baseWhere, _count: { id: true } }),
    ]);

    return { total, confidential, expired, expiringSoon, byCategory, byStatus };
  }

  async getAuditHistory(id: string, user: AuthUser) {
    await this.findOne(id, user);
    return this.prisma.auditLog.findMany({
      where: { entityType: 'Document', entityId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { id: true, fullName: true } } },
    });
  }

  async findByEntity(
    ownerType: DocumentOwnerType,
    ownerId: string,
    user: AuthUser,
    ipAddress?: string,
  ) {
    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
    const where: Prisma.DocumentWhereInput = { ownerType, ownerId, deletedAt: null };
    if (accessibleIds !== null) where.companyId = { in: accessibleIds };

    const docs = await this.prisma.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { uploadedBy: { select: { fullName: true } } },
    });

    await this.auditLogs.log({
      action: 'DOCUMENT_ENTITY_LIST',
      entityType: 'Document',
      userId: user.id,
      ipAddress,
      metadata: { ownerType, ownerId, count: docs.length },
    });

    return docs;
  }
}
