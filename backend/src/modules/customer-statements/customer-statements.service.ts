import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, CurrencyCode, Prisma, CustomerStatementRun } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { EmailService } from '../../common/services/email.service';
import { PrintEngineService } from '../print-engine/print-engine.service';
import { buildBusinessPdf } from '../generated-documents/pdf-builder';
import { dateRangeEnd, dateRangeStart } from '../../common/utils/date-range';
import { GenerateCustomerStatementDto } from './dto/generate-customer-statement.dto';
import { QueryCustomerStatementDto } from './dto/query-customer-statement.dto';
import { DetailStatementQueryDto } from './dto/detail-statement.dto';
import { ExportStatementDto } from './dto/export-statement.dto';
import { EmailStatementDto } from './dto/email-statement.dto';
import { CustomerStatement } from './statement.types';
import { CustomerAccountProjectionService } from './customer-account-projection.service';
import { customerStatementPdf } from './customer-statement-pdf';
import { summarizeDatedMovements } from '../../common/utils/settlement-history';

const VERSION = 'customer-account-v1';
const D = (value: string | number | Prisma.Decimal = 0) => new Prisma.Decimal(value);
type Selection = {
  companyId: string;
  customerId: string;
  dateFrom: string;
  dateTo: string;
  currency?: string;
  divisionId?: string;
  branchId?: string;
};
const canonical = (value: any): any =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const hash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');

@Injectable()
export class CustomerStatementsService {
  private readonly projection: CustomerAccountProjectionService;
  private readonly organization: OrganizationScopeService;
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly printEngine?: PrintEngineService,
    private readonly email?: EmailService,
    projection?: CustomerAccountProjectionService,
    organization?: OrganizationScopeService,
  ) {
    // Older direct constructors still get the actual mandatory scope service;
    // no mock-shaped fallback or company-only permission path is permitted.
    this.organization = organization ?? new OrganizationScopeService(prisma);
    this.projection =
      projection ?? new CustomerAccountProjectionService(prisma, companyScope, this.organization);
  }
  async findAll(query: QueryCustomerStatementDto, user: AuthUser) {
    const companyWhere = await this.companyScope.companyWhereFor(user, query.companyId);
    const grants = await this.organization.accessibleIds(user);
    const runs = await this.prisma.customerStatementRun.findMany({
      where: { ...companyWhere, ...(query.customerId ? { customerId: query.customerId } : {}) },
      select: {
        id: true,
        statementRunNumber: true,
        companyId: true,
        customerId: true,
        periodStart: true,
        periodEnd: true,
        openingBalance: true,
        totalDebits: true,
        totalCredits: true,
        closingBalance: true,
        currency: true,
        status: true,
        generatedById: true,
        generatedAt: true,
        createdAt: true,
        documentId: true,
        calculationVersion: true,
        snapshotHash: true,
        snapshot: true,
        company: { select: { id: true, name: true, code: true } },
        generatedBy: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 5001,
    });
    if (runs.length > 5000)
      throw new BadRequestException('Choose a company or customer to narrow statement history.');
    const visible = runs.filter(
      (run) => grants.unrestricted || this.scopeAllowed((run.snapshot as any)?.scope, grants),
    );
    const page = Math.max(1, Number(query.page ?? 1)),
      limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const data = await this.projectSavedRuns(visible.slice((page - 1) * limit, page * limit), user);
    return {
      data,
      items: data,
      total: visible.length,
      page,
      limit,
      totalPages: Math.ceil(visible.length / limit),
    };
  }
  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const run = await this.savedRun(id, user, minimum);
    return (await this.projectSavedRuns([run], user))[0];
  }
  /** Customer profiles use issued snapshots unchanged; legacy summaries expose
   * separately labeled reconciled balances without inventing issued detail. */
  async projectSavedRuns<
    T extends Pick<
      CustomerStatementRun,
      | 'id'
      | 'companyId'
      | 'customerId'
      | 'currency'
      | 'snapshot'
      | 'periodStart'
      | 'periodEnd'
      | 'openingBalance'
      | 'totalDebits'
      | 'totalCredits'
      | 'closingBalance'
    >,
  >(runs: T[], user: AuthUser) {
    await Promise.all(
      [...new Set(runs.map((run) => run.companyId))].map((companyId) =>
        this.companyScope.assertCanAccessCompany(user, companyId, AccessLevel.READ),
      ),
    );
    const grants = await this.organization.accessibleIds(user);
    const visible = runs.filter(
      (run) => grants.unrestricted || this.scopeAllowed((run.snapshot as any)?.scope, grants),
    );
    const ledgers = new Map<string, ReturnType<CustomerAccountProjectionService['read']>>();
    const keyFor = (run: T) => JSON.stringify([run.companyId, run.customerId, run.currency]);
    const latestDates = new Map<string, string>();
    for (const run of visible) {
      const key = keyFor(run),
        date = run.periodEnd.toISOString().slice(0, 10);
      if (!latestDates.has(key) || latestDates.get(key)! < date) latestDates.set(key, date);
    }
    return Promise.all(
      visible.map(async (run) => {
        if (run.snapshot) {
          await this.savedRun(run.id, user);
          return this.runSummary(run);
        }
        const key = keyFor(run);
        let ledger = ledgers.get(key);
        if (!ledger) {
          ledger = this.projection.read(user, {
            companyId: run.companyId,
            customerIds: run.customerId ? [run.customerId] : undefined,
            currency: run.currency as CurrencyCode,
            dateTo: latestDates.get(key)!,
          });
          ledgers.set(key, ledger);
        }
        const projection = await ledger;
        const datedBalances = summarizeDatedMovements(
          projection.accounts.flatMap((account) => account.movements),
          run.periodStart,
          dateRangeEnd(run.periodEnd.toISOString().slice(0, 10)),
        );
        const totals = {
          openingBalance: datedBalances.openingBalance,
          totalDebits: datedBalances.totalDebits,
          totalCredits: datedBalances.totalCredits,
          closingBalance: datedBalances.closingBalance,
        };
        return {
          ...this.runSummary(run),
          ...totals,
          storedBalances: {
            openingBalance: run.openingBalance,
            totalDebits: run.totalDebits,
            totalCredits: run.totalCredits,
            closingBalance: run.closingBalance,
          },
          datedBalances: totals,
          settlementHistory: this.combinedHistory(projection.accounts),
        };
      }),
    );
  }
  async savedDetail(id: string, user: AuthUser) {
    const run = await this.savedRun(id, user);
    if (!run.snapshot)
      throw new BadRequestException(
        'This older statement contains totals only. Generate a new issued statement to preserve account detail.',
      );
    return run.snapshot;
  }
  async generate(dto: GenerateCustomerStatementDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    if (!dto.customerId) return this.generateCompanySummary(dto, user);
    const s = await this.buildStatement(
      { ...dto, customerId: dto.customerId, dateFrom: dto.periodStart, dateTo: dto.periodEnd },
      user,
    );
    this.assertPreviewHash(dto.expectedHash, s);
    if (s.settlementHistory?.status === 'INCOMPLETE' || (s.integrityIssues ?? []).length > 0)
      throw new BadRequestException(
        'Resolve incomplete or partially scoped statement history before issuing this account statement.',
      );
    s.runId = randomUUID();
    s.statementRunNumber = `CSTAT-${s.generatedAt.toISOString().slice(0, 10).replace(/-/g, '')}-${s.runId.slice(0, 8).toUpperCase()}`;
    const pdfContent = buildBusinessPdf(customerStatementPdf(s));
    const snapshot = {
      ...this.serializeStatement(s),
      pdfSha256: createHash('sha256').update(pdfContent).digest('hex'),
    };
    const snapshotHash = hash(snapshot);
    const run = await this.prisma.$transaction(async (tx) => {
      const issued = await tx.customerStatementRun.create({
        data: {
          id: s.runId,
          statementRunNumber: s.statementRunNumber!,
          companyId: s.companyId,
          customerId: s.customerId,
          periodStart: s.dateFrom,
          periodEnd: s.dateTo,
          openingBalance: s.openingBalance,
          totalDebits: s.totalDebits,
          totalCredits: s.totalCredits,
          closingBalance: s.closingBalance,
          currency: s.currency,
          generatedById: user.id,
          generatedAt: s.generatedAt,
          status: 'GENERATED',
          snapshot: snapshot as Prisma.InputJsonValue,
          snapshotHash,
          pdfContent,
          calculationVersion: VERSION,
        },
      });
      await this.auditLogs.logStrictInTransaction(tx, {
        action: 'GENERATE',
        entityType: 'CustomerStatementRun',
        entityId: issued.id,
        userId: user.id,
        companyId: issued.companyId,
        metadata: { snapshotHash, calculationVersion: VERSION },
      });
      return issued;
    });
    return { ...this.runSummary(run), snapshot };
  }
  async getDetail(query: DetailStatementQueryDto, user: AuthUser) {
    return this.serializeStatement(await this.buildStatement(query, user));
  }
  async buildStatement(sel: Selection, user: AuthUser): Promise<CustomerStatement> {
    await this.companyScope.assertCanAccessCompany(user, sel.companyId);
    const from = dateRangeStart(sel.dateFrom),
      to = dateRangeEnd(sel.dateTo);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to)
      throw new BadRequestException('Choose a valid statement date range.');
    if (sel.currency && !Object.values(CurrencyCode).includes(sel.currency as CurrencyCode))
      throw new BadRequestException('Invalid statement currency');
    const currency = (sel.currency ?? CurrencyCode.TZS) as CurrencyCode;
    const result = await this.projection.read(user, {
      companyId: sel.companyId,
      divisionId: sel.divisionId,
      branchId: sel.branchId,
      currency,
      dateTo: sel.dateTo,
      customerIds: [sel.customerId],
    });
    const account = result.accounts.find(
      (a) => a.customer.id === sel.customerId && a.customer.companyId === sel.companyId,
    );
    if (!account)
      throw new NotFoundException(
        'Customer is not available in your selected organizational scope.',
      );
    let openingBalance = D(),
      totalDebits = D(),
      totalCredits = D();
    const lines = account.movements.filter((movement) => {
      if (movement.date < from) {
        openingBalance = openingBalance.plus(movement.debit).minus(movement.credit);
        return false;
      }
      return true;
    });
    let running = openingBalance;
    const statementLines = lines.map((movement) => {
      running = running.plus(movement.debit).minus(movement.credit);
      totalDebits = totalDebits.plus(movement.debit);
      totalCredits = totalCredits.plus(movement.credit);
      return { ...movement, balance: running };
    });
    return {
      companyId: sel.companyId,
      customerId: sel.customerId,
      customerName: account.customer.name,
      customerEmail: account.customer.email,
      company: account.customer.company,
      customer: account.customer,
      scope: result.scope,
      warnings: [...result.warnings, ...account.warnings],
      integrityIssues: account.integrityIssues,
      settlementHistory: account.settlementHistory,
      currency,
      dateFrom: from,
      dateTo: to,
      openingBalance,
      totalDebits,
      totalCredits,
      closingBalance: running,
      netBalance: account.netBalance,
      openInvoiceBalance: account.openInvoiceBalance,
      customerCredit: account.customerCredit,
      lineCount: statementLines.length,
      lines: statementLines,
      aging: account.aging,
      agingAsOf: to,
      generatedAt: new Date(),
    };
  }
  async exportPdf(
    dto: ExportStatementDto,
    user: AuthUser,
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string; documentId?: string }> {
    this.assertTemplate(dto.templateId);
    if (dto.runId) {
      const run = await this.savedRun(dto.runId, user);
      if (!run.snapshot || !run.pdfContent)
        throw new BadRequestException('This older run has no preserved statement PDF.');
      const s = this.deserializeStatement(run.snapshot);
      await this.auditExport(user, s, 'PDF');
      return {
        buffer: Buffer.from(run.pdfContent),
        filename: this.filename(s, 'pdf'),
        mimeType: 'application/pdf',
      };
    }
    const s = await this.buildStatement(this.selection(dto), user);
    this.assertPreviewHash(dto.expectedHash, s);
    const result = {
      buffer: buildBusinessPdf(customerStatementPdf(s)),
      filename: this.filename(s, 'pdf'),
      mimeType: 'application/pdf',
    };
    await this.auditExport(user, s, 'PDF');
    return result;
  }
  async exportExcel(
    dto: ExportStatementDto,
    user: AuthUser,
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string; documentId?: string }> {
    this.assertTemplate(dto.templateId);
    const s = dto.runId
      ? this.deserializeStatement(await this.savedDetail(dto.runId, user))
      : await this.buildStatement(this.selection(dto), user);
    if (!dto.runId) this.assertPreviewHash(dto.expectedHash, s);
    const result = {
      buffer: await this.excel(s),
      filename: this.filename(s, 'xlsx'),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    await this.auditExport(user, s, 'EXCEL');
    return result;
  }
  async emailToCustomer(dto: EmailStatementDto, user: AuthUser) {
    this.assertTemplate(dto.templateId);
    const s = dto.runId
      ? this.deserializeStatement(await this.savedDetail(dto.runId, user))
      : await this.buildStatement(this.selection(dto), user);
    if (!dto.runId) this.assertPreviewHash(dto.expectedHash, s);
    const currentCustomer = dto.runId
      ? await this.prisma.customer.findFirst({
          where: { id: s.customerId, companyId: s.companyId, deletedAt: null },
          select: { email: true },
        })
      : undefined;
    if (dto.runId && !currentCustomer)
      throw new NotFoundException('Customer is no longer available for statement email.');
    const to = dto.to ?? (dto.runId ? currentCustomer?.email : s.customerEmail),
      smtpConfigured = !!process.env.SMTP_HOST;
    const filename = this.filename(s, 'pdf'),
      pdf = dto.runId
        ? (await this.exportPdf({ runId: dto.runId } as ExportStatementDto, user)).buffer
        : buildBusinessPdf(customerStatementPdf(s));
    const escape = (v: string) =>
      v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const historyWarning =
      s.settlementHistory?.status === 'INCOMPLETE'
        ? `Settlement history is incomplete. Unresolved evidence: ${s.currency} ${s.settlementHistory.unresolvedAmount}. This statement is not reconciled.`
        : '';
    const emailed =
      to && this.email
        ? await this.email.sendEmailWithAttachments(
            to,
            `Statement of account — ${s.customerName ?? 'Customer'}`,
            `<p>${escape(historyWarning)}</p><p>Dear ${escape(s.customerName ?? 'Customer')},</p><p>Your attached statement covers ${s.dateFrom.toISOString().slice(0, 10)} to ${s.dateTo.toISOString().slice(0, 10)} (${s.currency}). Closing balance: ${s.closingBalance.toFixed(2)}.</p>`,
            `${historyWarning}\nStatement of account ${s.currency}; closing balance ${s.closingBalance.toFixed(2)}.`,
            [{ filename, content: pdf, contentType: 'application/pdf' }],
          )
        : false;
    await this.auditLogs.log({
      action: 'EMAIL',
      entityType: 'CustomerStatement',
      entityId: s.customerId,
      userId: user.id,
      companyId: s.companyId,
      metadata: { to: to ?? null, emailed, smtpConfigured, filename },
    });
    return {
      emailed,
      smtpConfigured,
      to: to ?? null,
      filename,
      closingBalance: s.closingBalance.toFixed(2),
      message: !to
        ? 'No recipient email available for this customer'
        : !smtpConfigured
          ? 'SMTP not configured — statement email skipped and logged'
          : emailed
            ? 'Statement emailed to customer with PDF attachment'
            : 'Statement email delivery failed or is unavailable',
    };
  }
  private async savedRun(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const run = await this.prisma.customerStatementRun.findFirst({ where: { id } });
    if (!run) throw new NotFoundException('Customer statement run not found');
    await this.companyScope.assertCanAccessCompany(user, run.companyId, minimum);
    const grants = await this.organization.accessibleIds(user, minimum);
    if (!grants.unrestricted && !this.scopeAllowed((run.snapshot as any)?.scope, grants))
      throw new ForbiddenException(
        'This statement includes divisions or branches outside your current access.',
      );
    if (run.snapshot && run.snapshotHash !== hash(run.snapshot))
      throw new BadRequestException('The saved statement integrity check failed.');
    if (
      run.snapshot &&
      run.pdfContent &&
      (run.snapshot as any).pdfSha256 !==
        createHash('sha256').update(Buffer.from(run.pdfContent)).digest('hex')
    )
      throw new BadRequestException('The saved statement PDF integrity check failed.');
    return run;
  }
  private scopeAllowed(
    scope: any,
    grants: { unrestricted: boolean; divisionIds: string[]; branchIds: string[] },
  ) {
    if (grants.unrestricted) return true;
    if (!scope) return false;
    if (scope.branchId)
      return (
        grants.branchIds.includes(scope.branchId) ||
        (scope.divisionId && grants.divisionIds.includes(scope.divisionId))
      );
    if (scope.divisionId) return grants.divisionIds.includes(scope.divisionId);
    if (scope.unrestricted) return false;
    return (
      (scope.divisionIds ?? []).every((id: string) => grants.divisionIds.includes(id)) &&
      (scope.branchIds ?? []).every((id: string) => grants.branchIds.includes(id)) &&
      (scope.divisionIds?.length ?? 0) + (scope.branchIds?.length ?? 0) > 0
    );
  }
  private runSummary(run: any) {
    const { snapshot, pdfContent, ...summary } = run;
    return { ...summary, hasSnapshot: !!snapshot, hasPdf: !!pdfContent || !!snapshot };
  }
  private serializeStatement(s: CustomerStatement) {
    const value = JSON.parse(
      JSON.stringify({
        ...s,
        openingBalance: s.openingBalance.toFixed(2),
        totalDebits: s.totalDebits.toFixed(2),
        totalCredits: s.totalCredits.toFixed(2),
        closingBalance: s.closingBalance.toFixed(2),
        netBalance: (s.netBalance ?? s.closingBalance).toFixed(2),
        openInvoiceBalance: (s.openInvoiceBalance ?? D(s.aging.total)).toFixed(2),
        customerCredit: (s.customerCredit ?? D()).toFixed(2),
        calculationVersion: VERSION,
        lines: s.lines.map((line) => ({
          ...line,
          debit: line.debit.toFixed(2),
          credit: line.credit.toFixed(2),
          balance: line.balance.toFixed(2),
        })),
      }),
    );
    value.contentHash = this.contentHash(value);
    return value;
  }
  private contentHash(value: any) {
    const { generatedAt, runId, statementRunNumber, contentHash, pdfSha256, ...content } = value;
    return hash(content);
  }
  private assertPreviewHash(expected: string | undefined, s: CustomerStatement) {
    if (expected && expected !== this.serializeStatement(s).contentHash)
      throw new BadRequestException(
        'Account activity changed after the preview. Refresh the statement before exporting.',
      );
  }
  private deserializeStatement(value: any): CustomerStatement {
    return {
      ...value,
      dateFrom: new Date(value.dateFrom),
      dateTo: new Date(value.dateTo),
      generatedAt: new Date(value.generatedAt),
      agingAsOf: new Date(value.agingAsOf),
      openingBalance: D(value.openingBalance),
      totalDebits: D(value.totalDebits),
      totalCredits: D(value.totalCredits),
      closingBalance: D(value.closingBalance),
      netBalance: D(value.netBalance),
      openInvoiceBalance: D(value.openInvoiceBalance),
      customerCredit: D(value.customerCredit),
      lines: value.lines.map((line: any) => ({
        ...line,
        date: new Date(line.date),
        debit: D(line.debit),
        credit: D(line.credit),
        balance: D(line.balance),
      })),
    };
  }
  private selection(dto: ExportStatementDto): Selection {
    if (!dto.companyId || !dto.customerId || !dto.dateFrom || !dto.dateTo)
      throw new BadRequestException('Provide a saved runId or a complete statement selection.');
    return {
      ...dto,
      companyId: dto.companyId,
      customerId: dto.customerId,
      dateFrom: dto.dateFrom,
      dateTo: dto.dateTo,
    };
  }
  private assertTemplate(templateId?: string) {
    if (templateId)
      throw new BadRequestException(
        'Customer account statements use the verified statement layout. Template overrides are not supported for this export.',
      );
  }
  private async generateCompanySummary(dto: GenerateCustomerStatementDto, user: AuthUser) {
    const from = dateRangeStart(dto.periodStart),
      to = dateRangeEnd(dto.periodEnd);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to)
      throw new BadRequestException('Choose a valid statement date range.');
    const projection = await this.projection.read(user, {
      companyId: dto.companyId,
      divisionId: dto.divisionId,
      branchId: dto.branchId,
      currency: dto.currency,
      dateTo: dto.periodEnd,
    });
    if (
      projection.accounts.some(
        (account) =>
          account.settlementHistory?.status === 'INCOMPLETE' || account.integrityIssues?.length,
      )
    )
      throw new BadRequestException(
        'Statement cannot be generated until settlement history is reconciled',
      );
    let openingBalance = D(),
      totalDebits = D(),
      totalCredits = D();
    for (const account of projection.accounts)
      for (const line of account.movements) {
        if (line.date < from) openingBalance = openingBalance.plus(line.debit).minus(line.credit);
        else {
          totalDebits = totalDebits.plus(line.debit);
          totalCredits = totalCredits.plus(line.credit);
        }
      }
    const run = await this.prisma.customerStatementRun.create({
      data: {
        statementRunNumber: `CSTAT-${randomUUID()}`,
        companyId: dto.companyId,
        customerId: null,
        periodStart: from,
        periodEnd: to,
        openingBalance,
        totalDebits,
        totalCredits,
        closingBalance: openingBalance.plus(totalDebits).minus(totalCredits),
        currency: projection.currency,
        generatedById: user.id,
        status: 'GENERATED',
        calculationVersion: VERSION,
      },
    });
    await this.auditLogs.log({
      action: 'GENERATE',
      entityType: 'CustomerStatementRun',
      entityId: run.id,
      userId: user.id,
      companyId: dto.companyId,
      metadata: {
        customerId: null,
        statementBasis: 'Scoped company summary; no customer-issued snapshot',
      },
    });
    return this.runSummary(run);
  }
  private combinedHistory(
    accounts: Array<{
      settlementHistory?: NonNullable<CustomerStatement['settlementHistory']>;
    }>,
  ) {
    const histories = accounts.flatMap((account) =>
      account.settlementHistory ? [account.settlementHistory] : [],
    );
    const gaps = histories.flatMap((history) => history.gaps);
    return {
      status: gaps.length ? ('INCOMPLETE' as const) : ('COMPLETE' as const),
      recoveredLegacySettlements: histories.reduce(
        (sum, history) => sum + history.recoveredLegacySettlements,
        0,
      ),
      unresolvedAmount: gaps.reduce((sum, gap) => sum.plus(D(gap.amount).abs()), D()).toFixed(2),
      gaps,
    };
  }
  private filename(s: CustomerStatement, ext: string) {
    const name = (s.customerName ?? s.customerId).replace(/[^a-z0-9-]+/gi, '_');
    return `${s.statementRunNumber ?? 'statement'}_${name}_${s.dateFrom.toISOString().slice(0, 10)}_${s.dateTo.toISOString().slice(0, 10)}.${ext}`;
  }
  private async auditExport(user: AuthUser, s: CustomerStatement, format: string) {
    await this.auditLogs.log({
      action: 'EXPORT',
      entityType: 'CustomerStatement',
      entityId: s.runId ?? s.customerId,
      userId: user.id,
      companyId: s.companyId,
      metadata: { format, dateFrom: s.dateFrom.toISOString(), dateTo: s.dateTo.toISOString() },
    });
  }
  private async excel(s: CustomerStatement): Promise<Buffer> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExcelJS = require('exceljs');
    // Excel retains only 15 significant digits. Preserve larger amounts as
    // exact decimal text rather than silently losing cents in numerical cells.
    const cellAmount = (value: Prisma.Decimal | string | number) => {
      const amount = D(value);
      return amount.abs().gte('10000000000000') ? amount.toFixed(2) : amount.toNumber();
    };
    const workbook = new ExcelJS.Workbook();
    workbook.creator = s.company?.name ?? 'ITEMBA-R';
    workbook.created = s.generatedAt;
    const sheet = workbook.addWorksheet('Statement', { views: [{ state: 'frozen', ySplit: 7 }] });
    sheet.addRow([this.safeCell(s.company?.name ?? 'Itemba Group')]).font = {
      bold: true,
      size: 16,
    };
    sheet.addRow(['Statement of Account', this.safeCell(s.customerName ?? s.customerId)]);
    sheet.addRow(['Statement reference', s.statementRunNumber ?? 'Preview']);
    sheet.addRow([
      'Period',
      `${s.dateFrom.toISOString().slice(0, 10)} to ${s.dateTo.toISOString().slice(0, 10)}`,
    ]);
    sheet.addRow(['Currency', s.currency]);
    sheet.addRow(['Generated', s.generatedAt.toISOString()]);
    const headers = sheet.addRow([
      'Date',
      'Description',
      'Reference',
      'Debit',
      'Credit',
      'Balance',
    ]);
    headers.font = { bold: true };
    headers.eachCell((cell: any) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
    });
    sheet.addRow([
      s.dateFrom.toISOString().slice(0, 10),
      'Opening balance',
      '',
      null,
      null,
      cellAmount(s.openingBalance),
    ]);
    for (const line of s.lines)
      sheet.addRow([
        line.date.toISOString().slice(0, 10),
        this.safeCell(line.description),
        this.safeCell(line.reference),
        line.debit.isZero() ? null : cellAmount(line.debit),
        line.credit.isZero() ? null : cellAmount(line.credit),
        cellAmount(line.balance),
      ]);
    sheet.addRow([
      s.dateTo.toISOString().slice(0, 10),
      'Closing balance',
      '',
      cellAmount(s.totalDebits),
      cellAmount(s.totalCredits),
      cellAmount(s.closingBalance),
    ]).font = { bold: true };
    sheet.columns = [
      { width: 14 },
      { width: 58 },
      { width: 26 },
      { width: 21, style: { numFmt: '#,##0.00;[Red](#,##0.00)' } },
      { width: 21, style: { numFmt: '#,##0.00;[Red](#,##0.00)' } },
      { width: 21, style: { numFmt: '#,##0.00;[Red](#,##0.00)' } },
    ];
    sheet.addRow([]);
    sheet.addRow([`Invoice aging as of ${s.dateTo.toISOString().slice(0, 10)}`]).font = {
      bold: true,
    };
    for (const [key, value] of Object.entries(s.aging))
      sheet.addRow([key, key === 'oldestDaysOverdue' ? value : cellAmount(value)]);
    sheet.addRow(['Open invoice balance', cellAmount(s.openInvoiceBalance ?? D(s.aging.total))]);
    sheet.addRow(['Customer credit / deposits', cellAmount(s.customerCredit ?? D())]);
    for (const warning of s.warnings ?? [])
      sheet.addRow(['Statement basis', this.safeCell(warning)]);
    sheet.eachRow((row: any) => {
      row.eachCell((cell: any) => {
        if (typeof cell.value === 'string' && /^-?\d+\.\d{2}$/.test(cell.value)) {
          cell.alignment = { horizontal: 'right' };
          cell.note =
            'Stored as exact text to preserve cents. Excel numerical cells round amounts of this size.';
        }
      });
    });
    sheet.pageSetup = {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: '7:7',
    };
    sheet.headerFooter.oddFooter = '&LStatement of Account&RPage &P of &N';
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
  private safeCell(value: string) {
    return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  }
}
