'use client';

/**
 * Mobile POS Day Reports — the office side of Funga Siku.
 *
 * A rep closes her day on the phone and the close does two things: it hands
 * her a letterhead PDF for the share sheet, and it submits a record to the
 * office (spec-history-reports §1.3). This page is where the office reads that
 * record. Without it the "submit" half of the ritual has no reader.
 *
 * Everything here is read-only. A day report creates no financial fact, no
 * stock movement and no GL entry — it is a timestamped snapshot of SalesOrder
 * rows that already exist — so there is nothing on this screen to edit,
 * approve or post. Corrections are a new close from the phone (§1.8).
 *
 * Scope and permission: `mobile_pos_lite.manage`, the existing terminal-admin
 * gate (§1.7). The endpoint resolves company scope from the AuthUser, never
 * from a client-supplied companyId.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Btn,
  Card,
  DateInput,
  DetailDrawer,
  EmptyState,
  ErrorState,
  FormSelect,
  PageHeader,
  PageSpinner,
  PageToolbar,
  PermissionDeniedState,
  StatCard,
  StatusBadge,
  showToast,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useOrgScope } from '@/hooks/use-org-scope';
import { backendList } from '@/lib/api-client';
import { downloadTablePdf } from '@/lib/export-download';
import { downloadTextFile, rowsToCsv } from '@/lib/report-export';
import {
  DAY_REPORT_EXPORT_COLUMNS,
  DAY_REPORT_WINDOW_LIMIT,
  annotateSupersession,
  buildDayReportDetailPdf,
  buildDayReportExportRows,
  buildDayReportRegisterPdf,
  filterDayReports,
  formatBusinessDate,
  formatDateTime,
  formatMoney,
  formatQuantity,
  methodBreakdownTotal,
  methodLabel,
  normalizeDayReports,
  summarizeDayReports,
  SUPERSESSION_MECHANISM,
  type AnnotatedDayReport,
  type DayReportSupersession,
  type MobilePosDayReport,
} from './day-reports-data';

/**
 * The subset of `GET /mobile-pos-lite/terminals` this page reads. It is the
 * authoritative POS population and rides the same `mobile_pos_lite.manage`
 * gate as the register itself, so it costs no extra permission.
 */
interface PosTerminal {
  id: string;
  code: string;
  name: string;
  company?: { id: string; name: string; code?: string | null } | null;
  branch?: { id: string; name: string; code?: string | null } | null;
  assignedUser?: { id: string; name: string } | null;
}

interface Option {
  value: string;
  label: string;
}

const textMutedStyle = { color: 'var(--aurora-text-muted)' } as const;
const textSecondaryStyle = { color: 'var(--aurora-text-secondary)' } as const;
const borderStyle = { borderColor: 'var(--aurora-border)' } as const;
const subtlePanelStyle = {
  background: 'var(--aurora-bg-subtle)',
  borderColor: 'var(--aurora-border)',
} as const;

const thCls = 'px-4 py-3 text-left text-xs uppercase font-medium';
const tdCls = 'px-4 py-3 text-sm';

/** Hover copy on a figure the totals deliberately did not add. */
const SUPERSEDED_FIGURE_HINT =
  'Not added to the totals above: a later close of this terminal-day recomputed the whole day and already contains these figures.';

/**
 * The row's place in its terminal-day's close history, shown only when the day
 * was closed more than once. A single close needs no explanation and would only
 * add noise to every ordinary row.
 */
function CloseMark({ mark }: { mark: DayReportSupersession }) {
  if (mark.closeCount === 1) return null;
  if (!mark.counted) {
    return (
      <div className="mt-1 flex items-center gap-1.5">
        <StatusBadge status="SUPERSEDED" />
        <span className="text-[11px]" style={textMutedStyle}>
          close {mark.closeNumber} of {mark.closeCount}
        </span>
      </div>
    );
  }
  return (
    <div className="mt-1 text-[11px]" style={textSecondaryStyle}>
      Counted · close {mark.closeNumber} of {mark.closeCount}
    </div>
  );
}

/** Local calendar day as `YYYY-MM-DD` — never a UTC instant. */
function isoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function daysAgo(count: number): string {
  const date = new Date();
  date.setDate(date.getDate() - count);
  return isoDay(date);
}

function sortOptions(options: Option[]): Option[] {
  return [...options].sort((a, b) => a.label.localeCompare(b.label));
}

export default function MobilePosDayReportsPage() {
  const { hasPermission } = useAuth();
  // The office list is gated on the terminal-admin permission (§1.5); the
  // per-terminal PDF stays on the phone and is not reachable from here.
  const canView = hasPermission('mobile_pos_lite.manage');

  // Filters the endpoint carries (§1.5: terminalId, from, to).
  const [from, setFrom] = useState(() => daysAgo(6));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [terminalId, setTerminalId] = useState('');
  // Filters applied over the returned window — see filterDayReports.
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [repId, setRepId] = useState('');

  const [reports, setReports] = useState<MobilePosDayReport[] | null>(null);
  const [terminals, setTerminals] = useState<PosTerminal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<AnnotatedDayReport | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingDetail, setExportingDetail] = useState(false);

  // Branch options come from the shared org-scope hook, the house source for
  // company/branch cascades. Reps do NOT: `rep.id` on the record is a User id,
  // while useOrgScope's employees are HR employees keyed differently, so those
  // options would silently never match a row.
  const { companyOptions, branchOptions } = useOrgScope(companyId || undefined, {
    skipDivisions: true,
    skipEmployees: true,
  });

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    backendList<PosTerminal>('/mobile-pos-lite/terminals')
      .then((rows) => {
        if (!cancelled) setTerminals(rows);
      })
      .catch(() => {
        // Terminal lookups only populate filter dropdowns; the register itself
        // still loads and renders every name it needs from the record.
        if (!cancelled) setTerminals([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canView]);

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const rows = await backendList<unknown>('/mobile-pos-lite/day-reports', {
        query: {
          from: from || undefined,
          to: to || undefined,
          terminalId: terminalId || undefined,
        },
      });
      setReports(normalizeDayReports(rows));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load day reports');
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [canView, from, to, terminalId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadedReports = useMemo(() => reports ?? [], [reports]);

  /** terminal id → company id, so the company filter can reach the record. */
  const terminalCompany = useMemo(() => {
    const map = new Map<string, string>();
    terminals.forEach((terminal) => {
      if (terminal.company?.id) map.set(terminal.id, terminal.company.id);
    });
    return map;
  }, [terminals]);

  // The terminal list follows the company and branch already chosen, so the
  // three filters cannot be set to a combination that matches nothing.
  const terminalOptions = useMemo<Option[]>(
    () =>
      sortOptions(
        terminals
          .filter((terminal) => !companyId || terminal.company?.id === companyId)
          .filter((terminal) => !branchId || terminal.branch?.id === branchId)
          .map((terminal) => ({
            value: terminal.id,
            label: terminal.code ? `${terminal.code} — ${terminal.name}` : terminal.name,
          })),
      ),
    [terminals, companyId, branchId],
  );

  /**
   * Branch options prefer the canonical company cascade. When no company is
   * picked (or the cascade is empty) they fall back to the branches actually
   * present on the terminals and the loaded records, so the filter is never
   * an empty dropdown over a list that plainly has branches in it.
   */
  const branchFilterOptions = useMemo<Option[]>(() => {
    if (companyId && branchOptions.length > 0) return branchOptions;
    const seen = new Map<string, string>();
    terminals.forEach((terminal) => {
      if (terminal.branch?.id) {
        seen.set(
          terminal.branch.id,
          terminal.branch.code
            ? `${terminal.branch.code} — ${terminal.branch.name}`
            : terminal.branch.name,
        );
      }
    });
    loadedReports.forEach((report) => {
      if (report.branch.id && !seen.has(report.branch.id)) {
        seen.set(report.branch.id, report.branch.name || report.branch.id);
      }
    });
    return sortOptions(Array.from(seen, ([value, label]) => ({ value, label })));
  }, [companyId, branchOptions, terminals, loadedReports]);

  /**
   * Reps come from the terminal assignments unioned with whoever actually
   * closed a day in the window — a shift handover puts a second rep on one
   * terminal (§8-D case 8), and she must be selectable.
   */
  const repOptions = useMemo<Option[]>(() => {
    const seen = new Map<string, string>();
    terminals.forEach((terminal) => {
      if (terminal.assignedUser?.id) seen.set(terminal.assignedUser.id, terminal.assignedUser.name);
    });
    loadedReports.forEach((report) => {
      if (report.rep.id) seen.set(report.rep.id, report.rep.name || report.rep.id);
    });
    return sortOptions(Array.from(seen, ([value, label]) => ({ value, label })));
  }, [terminals, loadedReports]);

  // One company in scope is the ordinary case; pick it so the branch cascade
  // is usable without a click nobody would understand the need for.
  useEffect(() => {
    if (companyId || terminals.length === 0) return;
    const ids = new Set(terminals.map((terminal) => terminal.company?.id).filter(Boolean));
    if (ids.size === 1) {
      const [only] = Array.from(ids);
      if (only) setCompanyId(only);
    }
  }, [terminals, companyId]);

  /**
   * Supersession is resolved AFTER the filters, over exactly the rows on the
   * screen. That is what makes the register verifiable by hand: the totals are
   * the sum of the rows this table marks as counted, whatever the date range,
   * branch, rep or terminal is set to. Resolving it over the unfiltered window
   * instead could mark a row as superseded by a close the reader cannot see.
   */
  const visibleReports = useMemo(
    () =>
      annotateSupersession(
        filterDayReports(loadedReports, { companyId, branchId, repId }, terminalCompany),
      ),
    [loadedReports, companyId, branchId, repId, terminalCompany],
  );

  const totals = useMemo(() => summarizeDayReports(visibleReports), [visibleReports]);

  // The endpoint takes no page parameter and caps at 100 rows, so a full
  // window means older submissions exist that this screen is not showing.
  const windowFull = loadedReports.length >= DAY_REPORT_WINDOW_LIMIT;
  // A single company auto-selected below narrows nothing, so it does not earn
  // the caveat; branch, rep and a genuinely chosen company do.
  const narrowedClientSide = Boolean(branchId || repId || (companyId && companyOptions.length > 1));

  const filterSummary = useMemo(() => {
    const parts = [
      from || to ? `${from || 'earliest'} to ${to || 'today'}` : null,
      terminalId ? terminalOptions.find((o) => o.value === terminalId)?.label : null,
      branchId ? branchFilterOptions.find((o) => o.value === branchId)?.label : null,
      repId ? repOptions.find((o) => o.value === repId)?.label : null,
    ].filter(Boolean);
    return parts.join(' · ');
  }, [from, to, terminalId, branchId, repId, terminalOptions, branchFilterOptions, repOptions]);

  const exportCsv = useCallback(() => {
    const csv = rowsToCsv(buildDayReportExportRows(visibleReports), DAY_REPORT_EXPORT_COLUMNS);
    if (!csv) return;
    downloadTextFile(
      `mobile-pos-day-reports-${isoDay(new Date())}.csv`,
      'text/csv;charset=utf-8',
      csv,
    );
  }, [visibleReports]);

  const exportPdf = useCallback(async () => {
    if (visibleReports.length === 0) return;
    setExportingPdf(true);
    try {
      // Assembled by the same module that computes the screen's totals, so the
      // paper an accountant files cannot carry a different number from the one
      // she read (see `buildDayReportRegisterPdf`).
      await downloadTablePdf(
        buildDayReportRegisterPdf({
          reports: visibleReports,
          subtitle: filterSummary,
          companyId,
          windowFull,
        }),
      );
    } catch (err) {
      showToast(
        'error',
        'PDF export failed',
        err instanceof Error ? err.message : 'PDF export failed',
      );
    } finally {
      setExportingPdf(false);
    }
  }, [visibleReports, filterSummary, companyId, windowFull]);

  const exportDetailPdf = useCallback(async (report: AnnotatedDayReport) => {
    setExportingDetail(true);
    try {
      await downloadTablePdf(buildDayReportDetailPdf(report));
    } catch (err) {
      showToast(
        'error',
        'PDF export failed',
        err instanceof Error ? err.message : 'PDF export failed',
      );
    } finally {
      setExportingDetail(false);
    }
  }, []);

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader
          title="Mobile POS Day Reports"
          subtitle="End-of-day sales reports submitted from Mobile POS terminals"
        />
        <PermissionDeniedState
          title="Access restricted"
          description="Viewing Mobile POS day reports needs the mobile_pos_lite.manage permission."
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Mobile POS Day Reports"
        subtitle="End-of-day sales reports submitted from Mobile POS terminals — server-computed, read-only."
        breadcrumbs={[
          { label: 'Westsides', href: '/westsides' },
          { label: 'Mobile POS Terminals', href: '/westsides/mobile-pos/terminals' },
          { label: 'Day Reports' },
        ]}
      />

      {/*
        Every figure here counts a terminal-day once, from its latest close.
        The label says "Terminal-Days" rather than "Reports" because that is
        what the money below it is a total OF — and the hint keeps the raw
        submission count visible, since a day closed twice is itself something
        the office needs to see.
      */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Terminal-Days"
          value={totals.terminalDays}
          hint={
            totals.superseded > 0
              ? `${totals.submissions} submissions · ${totals.superseded} superseded`
              : `${totals.submissions} submission${totals.submissions === 1 ? '' : 's'}`
          }
        />
        <StatCard label="Sales" value={totals.salesCount} />
        <StatCard label="Gross Total" value={formatMoney(totals.grossTotal)} />
        <StatCard
          label="Still On Phones"
          value={formatMoney(totals.declaredHeldAmount)}
          hint={`${totals.declaredHeldCount} sale(s) declared unsent`}
          variant={totals.declaredHeldCount > 0 ? 'amber' : 'default'}
        />
      </div>

      <PageToolbar
        filters={
          <>
            <div className="w-40">
              <DateInput
                aria-label="Business date from"
                value={from}
                max={to || undefined}
                onChange={(event) => setFrom(event.target.value)}
              />
            </div>
            <div className="w-40">
              <DateInput
                aria-label="Business date to"
                value={to}
                min={from || undefined}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
            {companyOptions.length > 1 && (
              <div className="w-52">
                <FormSelect
                  aria-label="Filter by company"
                  value={companyId}
                  onChange={(event) => {
                    setCompanyId(event.target.value);
                    setBranchId('');
                    setTerminalId('');
                  }}
                  options={companyOptions}
                  placeholder="All companies"
                />
              </div>
            )}
            <div className="w-44">
              <FormSelect
                aria-label="Filter by branch"
                value={branchId}
                onChange={(event) => {
                  setBranchId(event.target.value);
                  // The chosen terminal may not be in the new branch; keeping it
                  // would filter the register down to nothing with no visible
                  // reason why.
                  setTerminalId('');
                }}
                options={branchFilterOptions}
                placeholder="All branches"
              />
            </div>
            <div className="w-44">
              <FormSelect
                aria-label="Filter by sales rep"
                value={repId}
                onChange={(event) => setRepId(event.target.value)}
                options={repOptions}
                placeholder="All reps"
              />
            </div>
            <div className="w-48">
              <FormSelect
                aria-label="Filter by terminal"
                value={terminalId}
                onChange={(event) => setTerminalId(event.target.value)}
                options={terminalOptions}
                placeholder="All terminals"
              />
            </div>
          </>
        }
        actions={
          <>
            <Btn variant="secondary" size="sm" onClick={() => void load()} loading={loading}>
              Refresh
            </Btn>
            <Btn
              variant="secondary"
              size="sm"
              onClick={exportCsv}
              disabled={visibleReports.length === 0}
              aria-label="Export filtered day reports to CSV"
            >
              Export CSV
            </Btn>
            <Btn
              variant="secondary"
              size="sm"
              onClick={() => void exportPdf()}
              disabled={visibleReports.length === 0}
              loading={exportingPdf}
              aria-label="Export filtered day reports to PDF"
            >
              Export PDF
            </Btn>
          </>
        }
      />

      {totals.superseded > 0 && (
        <div
          className="rounded-lg border px-4 py-3 text-[13px]"
          style={subtlePanelStyle}
          data-testid="superseded-disclosure"
        >
          <span className="font-medium">
            {totals.superseded} superseded close
            {totals.superseded === 1 ? '' : 's'} in this window
          </span>{' '}
          <span style={textSecondaryStyle}>
            {SUPERSESSION_MECHANISM} The totals above count each terminal-day once, from its latest
            close; the superseded rows stay in the table below, marked, and the exports carry the
            same figures.
          </span>
        </div>
      )}

      {windowFull && (
        <div className="rounded-lg border px-4 py-3 text-[13px]" style={subtlePanelStyle}>
          <span className="font-medium">
            Showing the {DAY_REPORT_WINDOW_LIMIT} most recent submissions
          </span>{' '}
          <span style={textSecondaryStyle}>
            in this date range — narrow the dates to reach older ones.
            {narrowedClientSide
              ? ' The branch and rep filters apply to this window only, so older matches are not counted above.'
              : ''}
          </span>
        </div>
      )}

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {loading && reports === null && <PageSpinner />}

      {reports !== null && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <caption className="sr-only">Mobile POS end-of-day sales reports</caption>
              <thead>
                <tr style={textMutedStyle}>
                  <th scope="col" className={thCls}>
                    Date
                  </th>
                  <th scope="col" className={thCls}>
                    Rep
                  </th>
                  <th scope="col" className={thCls}>
                    Terminal
                  </th>
                  <th scope="col" className={thCls}>
                    Branch
                  </th>
                  <th scope="col" className={`${thCls} text-right`}>
                    Sales
                  </th>
                  <th scope="col" className={`${thCls} text-right`}>
                    Gross Total
                  </th>
                  <th scope="col" className={thCls}>
                    Unsent
                  </th>
                  <th scope="col" className={thCls}>
                    Submitted
                  </th>
                  <th scope="col" className={`${thCls} text-right`}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleReports.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <EmptyState
                        title="No day reports"
                        description={
                          loadedReports.length > 0
                            ? 'No submissions match the branch and rep filters in this window.'
                            : 'Reports appear here once a rep closes her day on a Mobile POS terminal.'
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  visibleReports.map((report) => (
                    <tr
                      key={report.id}
                      className="hover:bg-slate-50"
                      data-counted={report.supersession.counted ? 'yes' : 'superseded'}
                    >
                      <td className={tdCls}>
                        <div className="font-medium">{formatBusinessDate(report.businessDate)}</div>
                        <div className="text-[11px] font-mono" style={textMutedStyle}>
                          {report.reference}
                        </div>
                        <CloseMark mark={report.supersession} />
                      </td>
                      <td className={tdCls}>{report.rep.name || '—'}</td>
                      <td className={tdCls}>
                        <div>{report.terminal.name || '—'}</div>
                        {report.terminal.code && (
                          <div className="text-[11px] font-mono" style={textMutedStyle}>
                            {report.terminal.code}
                          </div>
                        )}
                      </td>
                      <td className={tdCls} style={textSecondaryStyle}>
                        {report.branch.name || '—'}
                      </td>
                      {/*
                        A superseded close's figures are true of the snapshot and
                        wrong to add, so they are shown and visibly not counted —
                        muted, with the reason on hover. Striking them through
                        would claim they were never real.
                      */}
                      <td
                        className={`${tdCls} text-right tabular-nums`}
                        style={report.supersession.counted ? undefined : textMutedStyle}
                        title={report.supersession.counted ? undefined : SUPERSEDED_FIGURE_HINT}
                      >
                        {report.salesCount}
                      </td>
                      <td
                        className={`${tdCls} text-right tabular-nums ${
                          report.supersession.counted ? 'font-medium' : ''
                        }`}
                        style={report.supersession.counted ? undefined : textMutedStyle}
                        title={report.supersession.counted ? undefined : SUPERSEDED_FIGURE_HINT}
                      >
                        {formatMoney(report.grossTotal)}
                      </td>
                      <td className={tdCls}>
                        {report.declaredHeldCount > 0 ? (
                          <span
                            className="inline-flex items-center gap-2"
                            title="Sales the phone declared it was still holding when the day was closed. Not included in the gross total."
                          >
                            <StatusBadge status="PARTIAL" />
                            <span className="tabular-nums" style={textSecondaryStyle}>
                              {report.declaredHeldCount}
                            </span>
                          </span>
                        ) : (
                          <StatusBadge status="COMPLETED" />
                        )}
                      </td>
                      <td className={tdCls} style={textMutedStyle}>
                        {formatDateTime(report.submittedAt)}
                      </td>
                      <td className={`${tdCls} text-right`}>
                        <Btn variant="ghost" size="xs" onClick={() => setSelected(report)}>
                          View
                        </Btn>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {visibleReports.length > 0 && (
            <div
              className="border-t px-5 py-3 text-xs"
              style={{ ...borderStyle, ...textMutedStyle }}
            >
              {visibleReports.length} of {loadedReports.length} loaded submission
              {loadedReports.length === 1 ? '' : 's'}, covering {totals.terminalDays} terminal-day
              {totals.terminalDays === 1 ? '' : 's'}
              {totals.superseded > 0 ? ` (${totals.superseded} superseded)` : ''}. Every figure in a
              row except the unsent count is recomputed on the server from sales orders; the totals
              above add the latest close of each terminal-day only, never a superseded one.
            </div>
          )}
        </Card>
      )}

      <DayReportDrawer
        report={selected}
        onClose={() => setSelected(null)}
        onExport={exportDetailPdf}
        exporting={exportingDetail}
      />
    </div>
  );
}

/* ─── Detail drawer ─────────────────────────────────────────────────────────── */

interface DayReportDrawerProps {
  report: AnnotatedDayReport | null;
  onClose: () => void;
  onExport: (report: AnnotatedDayReport) => Promise<void>;
  exporting: boolean;
}

function DayReportDrawer({ report, onClose, onExport, exporting }: DayReportDrawerProps) {
  const breakdownTotal = report ? methodBreakdownTotal(report) : 0;
  // The breakdown and the gross come from two server aggregates over the same
  // window, so they agree in practice. Saying so when they do not is cheaper
  // than an accountant re-adding the column by hand to find out.
  const breakdownReconciles = report ? Math.abs(breakdownTotal - report.grossTotal) < 0.005 : true;

  return (
    <DetailDrawer
      open={report !== null}
      title={report ? formatBusinessDate(report.businessDate) : 'Day report'}
      subtitle={report ? `${report.reference} · ${report.rep.name || 'Unknown rep'}` : undefined}
      onClose={onClose}
      width="lg"
    >
      {report && (
        <div className="space-y-5">
          {report.supersession.closeCount > 1 && (
            <div
              className="rounded-lg border px-4 py-3 text-[13px]"
              style={subtlePanelStyle}
              data-testid="drawer-close-history"
            >
              <div className="font-semibold">
                {report.supersession.counted
                  ? `Close ${report.supersession.closeNumber} of ${report.supersession.closeCount} — the one counted`
                  : `Superseded — close ${report.supersession.closeNumber} of ${report.supersession.closeCount}`}
              </div>
              <p className="mt-1 leading-relaxed" style={textSecondaryStyle}>
                {SUPERSESSION_MECHANISM}{' '}
                {report.supersession.counted
                  ? 'The earlier closes of this terminal-day cover the same sales and are superseded by this one.'
                  : 'The figures below are true of this snapshot, but the register does not add them — the later close already contains them.'}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Business date" value={formatBusinessDate(report.businessDate)} />
            <Field label="Submitted" value={formatDateTime(report.submittedAt)} />
            <Field
              label="Terminal"
              value={
                report.terminal.code
                  ? `${report.terminal.code} — ${report.terminal.name}`
                  : report.terminal.name || '—'
              }
            />
            <Field label="Branch" value={report.branch.name || '—'} />
            <Field label="Sales rep" value={report.rep.name || '—'} />
            <Field label="Reference" value={report.reference} mono />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Metric label="Sales" value={String(report.salesCount)} />
            <Metric label="Gross total" value={formatMoney(report.grossTotal)} strong />
            <Metric label="Items sold" value={formatQuantity(report.itemsSoldQuantity)} />
          </div>

          <Section title="Payment methods">
            {report.byMethod.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm italic" style={textMutedStyle}>
                No payments recorded for this day.
              </p>
            ) : (
              <table className="w-full text-sm">
                <caption className="sr-only">Payment method breakdown</caption>
                <thead>
                  <tr style={textMutedStyle}>
                    <th scope="col" className="px-4 py-2 text-left text-xs uppercase">
                      Method
                    </th>
                    <th scope="col" className="px-4 py-2 text-right text-xs uppercase">
                      Count
                    </th>
                    <th scope="col" className="px-4 py-2 text-right text-xs uppercase">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.byMethod.map((line) => (
                    <tr key={`${line.paymentMethod}-${line.label ?? ''}`}>
                      <td className="px-4 py-2">{methodLabel(line)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{line.count}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatMoney(line.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-medium" style={borderStyle}>
                    <td className="px-4 py-2">Total</td>
                    <td className="px-4 py-2 text-right tabular-nums">{report.salesCount}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatMoney(breakdownTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
            {!breakdownReconciles && (
              <p className="px-4 pb-3 text-xs" style={{ color: 'var(--aurora-warning-text)' }}>
                The method breakdown totals {formatMoney(breakdownTotal)} against a gross of{' '}
                {formatMoney(report.grossTotal)}.
              </p>
            )}
          </Section>

          <Section title="Items sold">
            {report.items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm italic" style={textMutedStyle}>
                No items recorded for this day.
              </p>
            ) : (
              <table className="w-full text-sm">
                <caption className="sr-only">Item breakdown</caption>
                <thead>
                  <tr style={textMutedStyle}>
                    <th scope="col" className="px-4 py-2 text-left text-xs uppercase">
                      Item
                    </th>
                    <th scope="col" className="px-4 py-2 text-right text-xs uppercase">
                      Quantity
                    </th>
                    <th scope="col" className="px-4 py-2 text-right text-xs uppercase">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.items.map((item, index) => (
                    <tr key={item.productId || `${item.name}-${index}`}>
                      <td className="px-4 py-2">{item.name || item.productId || '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatQuantity(item.quantity)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatMoney(item.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {report.itemsTruncated && (
              <p className="px-4 pb-3 text-xs" style={textMutedStyle}>
                This list shows the highest-value items only. Every figure above it — sales, gross
                total and items sold — comes from an unbounded aggregate over the whole day and is
                exact; only the breakdown below is shortened.
              </p>
            )}
          </Section>

          {report.declaredHeldCount > 0 && (
            <div className="rounded-lg border px-4 py-3" style={subtlePanelStyle}>
              <div className="text-[13px] font-semibold">Sales still on the phone</div>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-lg font-semibold tabular-nums">
                  {formatMoney(report.declaredHeldAmount)}
                </span>
                <span className="text-[13px]" style={textSecondaryStyle}>
                  {report.declaredHeldCount} sale{report.declaredHeldCount === 1 ? '' : 's'} flagged
                  as unsent at close
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed" style={textMutedStyle}>
                Not included in the gross total above. This figure is declared by the phone — it is
                the one number on the report the server cannot verify. The sales themselves land in
                the book of the day their outbox drains, so they are counted then.
              </p>
            </div>
          )}

          <div className="flex justify-end">
            <Btn
              variant="secondary"
              size="sm"
              loading={exporting}
              onClick={() => void onExport(report)}
            >
              Export PDF
            </Btn>
          </div>
        </div>
      )}
    </DetailDrawer>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide" style={textMutedStyle}>
        {label}
      </div>
      <div className={`mt-0.5 text-sm ${mono ? 'font-mono text-[13px]' : ''}`}>{value}</div>
    </div>
  );
}

function Metric({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-lg border px-3 py-2" style={subtlePanelStyle}>
      <div className="text-[11px] font-medium uppercase tracking-wide" style={textMutedStyle}>
        {label}
      </div>
      <div className={`mt-1 tabular-nums ${strong ? 'text-[15px] font-semibold' : 'text-sm'}`}>
        {value}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border" style={borderStyle}>
      <div className="border-b px-4 py-2 text-[13px] font-semibold" style={borderStyle}>
        {title}
      </div>
      {children}
    </div>
  );
}
