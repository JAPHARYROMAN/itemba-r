'use client';
import { useCallback, useEffect, useState } from 'react';
import { backendAllPages } from '@/lib/backend-all-pages';

export interface LeaveTypeChoice {
  id: string;
  name: string;
  code?: string;
  isActive?: boolean;
}
/** Complete, company-scoped choices with cancellation and explicit retry. */
export function useLeaveTypes(companyId: string, enabled = true) {
  const [state, setState] = useState<{
    companyId: string;
    rows: LeaveTypeChoice[];
    loading: boolean;
    error: string;
  }>({ companyId: '', rows: [], loading: false, error: '' });
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    if (!companyId || !enabled) {
      setState({ companyId, rows: [], loading: false, error: '' });
      return () => controller.abort();
    }
    setState({ companyId, rows: [], loading: true, error: '' });
    backendAllPages<LeaveTypeChoice>('/hr/leave-types', { companyId }, controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) setState({ companyId, rows, loading: false, error: '' });
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setState({
            companyId,
            rows: [],
            loading: false,
            error: err instanceof Error ? err.message : 'Unable to load leave types.',
          });
      });
    return () => controller.abort();
  }, [companyId, enabled, revision]);
  const current = state.companyId === companyId && enabled;
  return {
    rows: current ? state.rows : [],
    loading: Boolean(companyId && enabled && (!current || state.loading)),
    error: current ? state.error : '',
    retry,
  };
}
