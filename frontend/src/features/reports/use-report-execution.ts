'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { backendGet, backendPost } from '@/lib/api-client';
import { reportError, reportRequest, summarizeResult } from './report-viewer-utils';
import type {
  CatalogEntry,
  ExplainResponse,
  LineageResponse,
  QualitySurface,
  QualityWarning,
  ReportFilters,
  ViewerRunManifest,
} from './report-viewer-types';

export type ReportExecution = {
  data: unknown;
  filters: ReportFilters;
  generatedAt: string;
  sourceUrl: string;
  lineage: LineageResponse | null;
  explanation: ExplainResponse | null;
  quality: { warnings: QualityWarning[]; surface?: QualitySurface } | null;
  manifest: ViewerRunManifest | null;
  notes: string[];
};

/** Keep data and every attached note bound to the same report, scope and period. */
export function useReportExecution(entry: CatalogEntry, filters: ReportFilters, allowed: boolean) {
  const key = JSON.stringify([entry, filters]);
  const live = useRef({ key, allowed });
  useLayoutEffect(() => {
    live.current = { key, allowed };
  });
  const pending = useRef<AbortController | null>(null);
  const [state, setState] = useState<{
    key: string;
    loading: boolean;
    error: string;
    result: ReportExecution | null;
  }>({ key: '', loading: false, error: '', result: null });
  useEffect(() => {
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [key, allowed]);
  async function run() {
    if (!allowed || pending.current) return;
    let request: ReturnType<typeof reportRequest>;
    try {
      request = reportRequest(entry, filters);
    } catch (cause) {
      setState({ key, loading: false, result: null, error: reportError(cause) });
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    const current = () =>
      !controller.signal.aborted && live.current.allowed && live.current.key === key;
    setState({ key, loading: true, error: '', result: null });
    const suffix = encodeURIComponent(entry.id);
    try {
      const [data, lineage, quality, explanation] = await Promise.allSettled([
        backendGet<unknown>(request.path, { query: request.query, signal: controller.signal }),
        backendGet<LineageResponse>(`/reports/lineage/${suffix}`, {
          query: filters,
          signal: controller.signal,
        }),
        backendGet<NonNullable<ReportExecution['quality']>>(
          `/reports/data-quality-warnings/${suffix}`,
          { query: filters, signal: controller.signal },
        ),
        backendGet<ExplainResponse>(`/reports/explain/${suffix}`, {
          query: filters,
          signal: controller.signal,
        }),
      ]);
      if (!current()) return;
      if (data.status === 'rejected') throw data.reason;
      const notes: string[] = [];
      if (lineage.status === 'rejected')
        notes.push(`Sources unavailable: ${reportError(lineage.reason)}`);
      if (quality.status === 'rejected')
        notes.push(`Quality checks unavailable: ${reportError(quality.reason)}`);
      if (explanation.status === 'rejected')
        notes.push(`Explanation unavailable: ${reportError(explanation.reason)}`);
      const result: ReportExecution = {
        data: data.value,
        filters: { ...filters },
        generatedAt: new Date().toISOString(),
        sourceUrl: request.sourceUrl,
        lineage: lineage.status === 'fulfilled' ? lineage.value : null,
        quality: quality.status === 'fulfilled' ? quality.value : null,
        explanation: explanation.status === 'fulfilled' ? explanation.value : null,
        manifest: null,
        notes,
      };
      try {
        result.manifest = await backendPost<ViewerRunManifest>(
          `/reports/viewer/${suffix}/run-manifest`,
          {
            companyId: filters.companyId || undefined,
            sourceUrl: request.sourceUrl,
            parameters: {
              divisionId: filters.divisionId || undefined,
              dateFrom: filters.dateFrom || undefined,
              dateTo: filters.dateTo || undefined,
              asOf: filters.asOf || undefined,
            },
            metrics: summarizeResult(data.value),
            dataQualityAttached: quality.status === 'fulfilled',
            lineageAttached: lineage.status === 'fulfilled',
          },
          { signal: controller.signal },
        );
      } catch (cause) {
        result.notes.push(`Run record unavailable: ${reportError(cause)}`);
      }
      if (current()) setState({ key, loading: false, result, error: '' });
    } catch (cause) {
      if (current()) setState({ key, loading: false, result: null, error: reportError(cause) });
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }
  const current = allowed && key === state.key;
  return {
    run,
    loading: current && state.loading,
    error: current ? state.error : '',
    result: current ? state.result : null,
    changed: allowed && !!state.result && state.key !== key,
  };
}
