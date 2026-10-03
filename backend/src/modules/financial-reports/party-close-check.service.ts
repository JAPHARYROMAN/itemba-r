import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialReportsService } from './financial-reports.service';

type ControlReport = Awaited<ReturnType<FinancialReportsService['getControlByParty']>>;
export type PartyCloseRole = 'AP' | 'AR';
export interface PartyCloseRow {
  role: PartyCloseRole;
  kind: 'supplier' | 'customer';
  partyId: string;
  name: string;
  code: string | null;
  control: string;
  subLedger: string;
  difference: string;
  documents: number;
}
interface PartyCloseSide {
  controlAccount: ControlReport['controlAccount'];
  totals: ControlReport['totals'];
  untaggedControl: string;
  parties: number;
}
export interface PartyCloseCheck {
  companyId: string;
  asOf: Date;
  baseCurrency: string;
  ap: PartyCloseSide;
  ar: PartyCloseSide;
  rows: PartyCloseRow[];
  differences: PartyCloseRow[];
  untagged: { ap: string; ar: string };
  hasDifferences: boolean;
}
export interface CloseAcknowledgement {
  reason: string;
}
const nonZero = (value: string) => Number(value) !== 0;

/**
 * Party linkage (Phase 3 PR-3): the control-by-party reconciliation as a period-close gate.
 * Read-only and derived: it reports what the ledger and the sub-ledger say, refuses a close
 * with differences unless the closer acknowledges them with a reason (audited), and records
 * both sides at close as snapshots. It never writes a balance.
 */
@Injectable()
export class PartyCloseCheckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: FinancialReportsService,
  ) {}

  async check(companyId: string, asOf: Date, user: AuthUser): Promise<PartyCloseCheck> {
    const iso = asOf.toISOString();
    const [ap, ar] = await Promise.all([
      this.reports.getControlByParty(companyId, 'AP', iso, user),
      this.reports.getControlByParty(companyId, 'AR', iso, user),
    ]);
    const side = (report: ControlReport): PartyCloseSide => ({
      controlAccount: report.controlAccount,
      totals: report.totals,
      untaggedControl: report.untaggedControl,
      parties: report.rows.length,
    });
    const rows: PartyCloseRow[] = [
      ...ap.rows.map((row) => ({ role: 'AP' as const, kind: 'supplier' as const, ...row })),
      ...ar.rows.map((row) => ({ role: 'AR' as const, kind: 'customer' as const, ...row })),
    ];
    const differences = rows.filter((row) => nonZero(row.difference));
    const untagged = { ap: ap.untaggedControl, ar: ar.untaggedControl };
    return {
      companyId,
      asOf,
      baseCurrency: ap.baseCurrency,
      ap: side(ap),
      ar: side(ar),
      rows,
      differences,
      untagged,
      hasDifferences: differences.length > 0 || nonZero(untagged.ap) || nonZero(untagged.ar),
    };
  }

  /** The close gate: a non-zero difference is refused unless acknowledged with a reason. */
  async checkOrRefuse(
    companyId: string,
    asOf: Date,
    user: AuthUser,
    acknowledged?: CloseAcknowledgement | null,
  ): Promise<PartyCloseCheck> {
    const check = await this.check(companyId, asOf, user);
    if (check.hasDifferences && !acknowledged) {
      const parts: string[] = [];
      const n = check.differences.length;
      if (n) parts.push(`${n} ${n === 1 ? 'party differs' : 'parties differ'} from the sub-ledger`);
      if (nonZero(check.untagged.ap)) parts.push(`AP control without a party ${check.untagged.ap}`);
      if (nonZero(check.untagged.ar)) parts.push(`AR control without a party ${check.untagged.ar}`);
      throw new BadRequestException({
        statusCode: 400,
        message:
          `Control accounts do not agree with the sub-ledger as of ${asOf.toISOString().slice(0, 10)}: ` +
          `${parts.join('; ')}. Review the differences and close with a reason.`,
        code: 'PARTY_CONTROL_DIFFERENCES',
        differences: check.differences,
        untagged: check.untagged,
      });
    }
    return check;
  }

  /** What the audit log keeps about the gate, including the acknowledgement reason. */
  auditMetadata(
    check: PartyCloseCheck,
    acknowledged?: CloseAcknowledgement | null,
  ): Record<string, unknown> {
    return {
      partyControl: {
        asOf: check.asOf.toISOString(),
        baseCurrency: check.baseCurrency,
        parties: check.rows.length,
        differences: check.differences.length,
        untagged: check.untagged,
        control: { ap: check.ap.totals.control, ar: check.ar.totals.control },
        subLedger: { ap: check.ap.totals.subLedger, ar: check.ar.totals.subLedger },
        acknowledged: !!acknowledged,
        reason: acknowledged?.reason ?? null,
      },
    };
  }

  /**
   * One row per party and role plus one 'NONE' row per role for the untagged control, all in
   * the base currency and sharing one snapshotAt so a close can be read back as a set.
   */
  async snapshot(
    tx: Prisma.TransactionClient,
    ctx: { companyId: string; accountingPeriodId: string; periodCloseId?: string | null; userId: string },
    check: PartyCloseCheck,
  ): Promise<number> {
    const base = {
      companyId: ctx.companyId,
      accountingPeriodId: ctx.accountingPeriodId,
      periodCloseId: ctx.periodCloseId ?? null,
      currency: check.baseCurrency,
      snapshotAt: new Date(),
      createdById: ctx.userId,
    };
    const data: Prisma.PartyBalanceSnapshotCreateManyInput[] = [
      ...check.rows.map((row) => ({
        ...base,
        role: row.role,
        partyType: row.kind === 'supplier' ? 'SUPPLIER' : 'CUSTOMER',
        partyId: row.partyId,
        partyName: row.name,
        subLedger: row.subLedger,
        control: row.control,
        difference: row.difference,
      })),
      ...(['AP', 'AR'] as const)
        .map((role) => ({ role, amount: role === 'AP' ? check.untagged.ap : check.untagged.ar }))
        .filter(({ amount }) => nonZero(amount))
        .map(({ role, amount }) => ({
          ...base,
          role,
          partyType: 'NONE',
          partyId: null,
          partyName: null,
          subLedger: '0.00',
          control: amount,
          difference: amount,
        })),
    ];
    if (!data.length) return 0;
    const result = await tx.partyBalanceSnapshot.createMany({ data });
    return result.count;
  }

  /** The latest close's snapshot set for a period, with how many closes were recorded. */
  async snapshots(accountingPeriodId: string) {
    const all = await this.prisma.partyBalanceSnapshot.findMany({
      where: { accountingPeriodId },
      orderBy: [{ snapshotAt: 'desc' }, { role: 'asc' }, { partyName: 'asc' }],
    });
    const latest = all[0]?.snapshotAt ?? null;
    const rows = latest ? all.filter((row) => row.snapshotAt.getTime() === latest.getTime()) : [];
    const money = (value: Prisma.Decimal) => new Prisma.Decimal(value).toFixed(2);
    return {
      accountingPeriodId,
      snapshotAt: latest,
      closes: new Set(all.map((row) => row.snapshotAt.getTime())).size,
      currency: rows[0]?.currency ?? null,
      differences: rows.filter((row) => nonZero(money(row.difference))).length,
      rows: rows.map((row) => ({
        id: row.id,
        role: row.role,
        partyType: row.partyType,
        kind:
          row.partyType === 'SUPPLIER' ? 'supplier' : row.partyType === 'CUSTOMER' ? 'customer' : null,
        partyId: row.partyId,
        partyName: row.partyName,
        currency: row.currency,
        subLedger: money(row.subLedger),
        control: money(row.control),
        difference: money(row.difference),
      })),
    };
  }
}
