import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { DataExportStatus, DataExportType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { DataExportsService } from '../../data-exports/data-exports.service';
import { JobContext, JobHandlerRegistry, JobResult } from '../job-handler.registry';

/**
 * DATA_EXPORT job handler.
 *
 * Phase 6 (P0-06 cont.): replaces the placeholder JSON shell with real
 * per-`exportType` extraction. Each branch returns a typed array of rows
 * appropriate for the export domain. The contract for callers is unchanged
 * — file at `filePath`, status `COMPLETED` — but the file now contains
 * actual data instead of an empty `rows: []`.
 *
 * Currently implemented extractors:
 *   - AUDIT_EVIDENCE_PACK     → AuditLog rows scoped by company / date / entityType
 *   - FINANCIAL_REPORT        → JournalEntry + lines scoped by company / date
 *   - SALES_REPORT            → SalesOrder + lines scoped by company / date
 *   - PURCHASE_REPORT         → PurchaseOrder + lines scoped by company / date
 *   - PAYROLL_REPORT          → PayrollEntry rows scoped by company / period
 *   - INVENTORY_REPORT        → InventoryMovement rows scoped by company / date
 *
 * Other types fall back to a metadata-only dump (legacy behavior). Adding
 * a new extractor is one switch case here plus optional filter validation.
 *
 * Filter shape (read from `DataExportLog.filters`):
 *   { dateFrom?: ISO, dateTo?: ISO, entityType?: string,
 *     payrollPeriodId?: string, productId?: string, locationId?: string }
 *
 * All extractors enforce the export's `companyId` so a misconfigured filter
 * cannot widen scope past the row's company.
 */
@Injectable()
export class DataExportJobHandler implements OnModuleInit {
  private readonly logger = new Logger(DataExportJobHandler.name);

  // Hard cap to keep a runaway filter from generating a multi-GB file.
  private readonly MAX_ROWS = 50_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: JobHandlerRegistry,
    private readonly exports: DataExportsService,
  ) {}

  onModuleInit(): void {
    this.registry.register('DATA_EXPORT', (ctx) => this.handle(ctx));
  }

  private async handle(ctx: JobContext): Promise<JobResult> {
    const exportLogId = ctx.payload.exportLogId as string | undefined;
    if (!exportLogId) throw new Error('payload.exportLogId is required');

    const exportLog = await this.prisma.dataExportLog.findUnique({
      where: { id: exportLogId },
    });
    if (!exportLog) throw new Error(`DataExportLog ${exportLogId} not found`);
    if (
      exportLog.status === DataExportStatus.COMPLETED &&
      exportLog.fileName &&
      exportLog.filePath
    ) {
      return {
        data: {
          fileName: exportLog.fileName,
          filePath: exportLog.filePath,
          skipped: true,
          reason: 'export already completed',
        },
      };
    }

    await this.exports.markRunning(exportLogId);

    try {
      const exportDir = process.env.EXPORTS_DIR ?? path.join(process.cwd(), 'uploads', 'exports');
      await fs.mkdir(exportDir, { recursive: true });

      const filters = (exportLog.filters as Record<string, any> | null) ?? {};
      const dateFrom = filters.dateFrom ? new Date(String(filters.dateFrom)) : undefined;
      const dateTo = filters.dateTo ? new Date(String(filters.dateTo)) : undefined;

      const rows = await this.extractRows(exportLog.exportType, exportLog.companyId, {
        ...filters,
        dateFrom,
        dateTo,
      });

      const fileName = this.safeExportFileName(exportLog.exportNumber);
      const filePath = this.resolveExportPath(exportDir, fileName);
      const content = JSON.stringify(
        {
          exportNumber: exportLog.exportNumber,
          exportType: exportLog.exportType,
          companyId: exportLog.companyId,
          filters: exportLog.filters ?? null,
          generatedAt: new Date().toISOString(),
          rowCount: rows.length,
          truncated: rows.length === this.MAX_ROWS,
          rows,
        },
        null,
        2,
      );
      await fs.writeFile(filePath, content, 'utf8');

      await this.exports.markCompleted(exportLogId, fileName, filePath);
      return { data: { fileName, filePath, rowCount: rows.length } };
    } catch (err) {
      await this.exports.markFailed(exportLogId, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  /**
   * Per-exportType row extractor. Every branch enforces the supplied
   * `companyId` so a stray filter value cannot widen the scope.
   */
  private async extractRows(
    exportType: DataExportType,
    companyId: string | null,
    filters: Record<string, any>,
  ): Promise<unknown[]> {
    const dateRange =
      filters.dateFrom || filters.dateTo
        ? {
            ...(filters.dateFrom ? { gte: filters.dateFrom as Date } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo as Date } : {}),
          }
        : undefined;

    switch (exportType) {
      case 'AUDIT_EVIDENCE_PACK': {
        const where: Prisma.AuditLogWhereInput = {
          ...(companyId ? { companyId } : {}),
          ...(dateRange ? { createdAt: dateRange } : {}),
          ...(filters.entityType ? { entityType: String(filters.entityType) } : {}),
        };
        return this.prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: this.MAX_ROWS,
          select: {
            id: true,
            action: true,
            entityType: true,
            entityId: true,
            userId: true,
            companyId: true,
            severity: true,
            ipAddress: true,
            userAgent: true,
            metadata: true,
            createdAt: true,
          },
        });
      }

      case 'FINANCIAL_REPORT': {
        if (!companyId) return [];
        const where: Prisma.JournalEntryWhereInput = {
          companyId,
          deletedAt: null,
          ...(dateRange ? { transactionDate: dateRange } : {}),
        };
        return this.prisma.journalEntry.findMany({
          where,
          orderBy: { transactionDate: 'desc' },
          take: this.MAX_ROWS,
          select: {
            id: true,
            journalNumber: true,
            transactionDate: true,
            description: true,
            status: true,
            totalDebit: true,
            totalCredit: true,
            lines: {
              select: {
                accountId: true,
                debit: true,
                credit: true,
                description: true,
              },
            },
          },
        });
      }

      case 'SALES_REPORT': {
        if (!companyId) return [];
        const where: Prisma.SalesOrderWhereInput = {
          companyId,
          deletedAt: null,
          ...(dateRange ? { orderDate: dateRange } : {}),
        };
        return this.prisma.salesOrder.findMany({
          where,
          orderBy: { orderDate: 'desc' },
          take: this.MAX_ROWS,
          select: {
            id: true,
            salesOrderNumber: true,
            orderDate: true,
            customerId: true,
            customerName: true,
            currency: true,
            subtotal: true,
            taxAmount: true,
            totalAmount: true,
            status: true,
            paymentStatus: true,
            lines: {
              select: {
                productId: true,
                quantity: true,
                unitPrice: true,
                lineTotal: true,
              },
            },
          },
        });
      }

      case 'PURCHASE_REPORT': {
        if (!companyId) return [];
        const where: Prisma.PurchaseOrderWhereInput = {
          companyId,
          deletedAt: null,
          ...(dateRange ? { orderDate: dateRange } : {}),
        };
        return this.prisma.purchaseOrder.findMany({
          where,
          orderBy: { orderDate: 'desc' },
          take: this.MAX_ROWS,
          select: {
            id: true,
            purchaseOrderNumber: true,
            orderDate: true,
            supplierId: true,
            supplierName: true,
            currency: true,
            subtotal: true,
            taxAmount: true,
            totalAmount: true,
            status: true,
            lines: {
              select: {
                productId: true,
                quantity: true,
                unitCost: true,
                lineTotal: true,
              },
            },
          },
        });
      }

      case 'PAYROLL_REPORT': {
        if (!companyId) return [];
        const where: Prisma.PayrollEntryWhereInput = {
          companyId,
          deletedAt: null,
          ...(filters.payrollPeriodId
            ? { payrollRun: { payrollPeriodId: String(filters.payrollPeriodId) } }
            : {}),
        };
        return this.prisma.payrollEntry.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: this.MAX_ROWS,
          select: {
            id: true,
            employeeId: true,
            payrollRunId: true,
            grossPay: true,
            netPay: true,
            totalDeductions: true,
            totalAllowances: true,
            createdAt: true,
          },
        });
      }

      case 'INVENTORY_REPORT': {
        if (!companyId) return [];
        const where: Prisma.InventoryMovementWhereInput = {
          companyId,
          ...(dateRange ? { movementDate: dateRange } : {}),
          ...(filters.productId ? { productId: String(filters.productId) } : {}),
          ...(filters.locationId ? { branchId: String(filters.locationId) } : {}),
        };
        return this.prisma.inventoryMovement.findMany({
          where,
          orderBy: { movementDate: 'desc' },
          take: this.MAX_ROWS,
          select: {
            id: true,
            movementNumber: true,
            movementDate: true,
            movementType: true,
            productId: true,
            branchId: true,
            quantity: true,
            unitCost: true,
            totalCost: true,
            referenceType: true,
            referenceId: true,
          },
        });
      }

      case 'TAX_REPORT': {
        if (!companyId) return [];
        const where: Prisma.TaxTransactionWhereInput = {
          companyId,
          deletedAt: null,
          ...(dateRange ? { transactionDate: dateRange } : {}),
          ...(filters.taxTypeId ? { taxTypeId: String(filters.taxTypeId) } : {}),
          ...(filters.direction ? { direction: filters.direction as any } : {}),
          ...(filters.status ? { status: filters.status as any } : {}),
        };
        return this.prisma.taxTransaction.findMany({
          where,
          orderBy: { transactionDate: 'desc' },
          take: this.MAX_ROWS,
          select: {
            id: true,
            taxTransactionNumber: true,
            transactionDate: true,
            taxTypeId: true,
            taxCodeId: true,
            taxRateId: true,
            sourceType: true,
            sourceId: true,
            taxableAmount: true,
            taxAmount: true,
            currency: true,
            direction: true,
            status: true,
            journalEntryId: true,
            postedAt: true,
            notes: true,
          },
        });
      }

      case 'HR_REPORT': {
        if (!companyId) return [];
        // HR_REPORT covers the active employee roster. Filterable by
        // employmentStatus and departmentId.
        const where: Prisma.EmployeeWhereInput = {
          companyId,
          deletedAt: null,
          ...(filters.employmentStatus
            ? { employmentStatus: filters.employmentStatus as any }
            : {}),
          ...(filters.departmentId ? { departmentId: String(filters.departmentId) } : {}),
        };
        return this.prisma.employee.findMany({
          where,
          orderBy: { fullName: 'asc' },
          take: this.MAX_ROWS,
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
            email: true,
            phone: true,
            employmentStatus: true,
            employmentType: true,
            departmentId: true,
            positionId: true,
            hireDate: true,
            terminationDate: true,
            baseSalary: true,
            salaryCurrency: true,
          },
        });
      }

      case 'COMPLIANCE_REPORT': {
        if (!companyId) return [];
        const where: Prisma.ComplianceObligationWhereInput = {
          companyId,
          deletedAt: null,
          ...(dateRange ? { dueDate: dateRange } : {}),
          ...(filters.status ? { status: filters.status as any } : {}),
          ...(filters.priority ? { priority: filters.priority as any } : {}),
          ...(filters.obligationType ? { obligationType: filters.obligationType as any } : {}),
        };
        return this.prisma.complianceObligation.findMany({
          where,
          orderBy: { dueDate: 'asc' },
          take: this.MAX_ROWS,
          select: {
            id: true,
            obligationCode: true,
            obligationType: true,
            title: true,
            description: true,
            dueDate: true,
            recurrence: true,
            priority: true,
            status: true,
            responsibleUserId: true,
            completedAt: true,
          },
        });
      }

      default:
        // DOCUMENT_EXPORT, OTHER — fall back to a metadata-only dump.
        this.logger.warn(
          `No row extractor for exportType=${exportType}; returning metadata-only dump`,
        );
        return [];
    }
  }

  private safeExportFileName(exportNumber: string): string {
    const normalized = exportNumber
      .replace(/[^A-Za-z0-9._-]/g, '_')
      .replace(/^\.+/, '')
      .slice(0, 120);
    return `${normalized || 'export'}.json`;
  }

  private resolveExportPath(exportDir: string, fileName: string): string {
    const root = path.resolve(exportDir);
    const filePath = path.resolve(root, fileName);
    const relative = path.relative(root, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Resolved export file path escapes EXPORTS_DIR');
    }
    return filePath;
  }
}
