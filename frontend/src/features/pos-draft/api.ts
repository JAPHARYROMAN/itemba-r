import { backendGet, backendPost } from '@/lib/api-client';
import type { Draft, DraftAction, DraftContext, DraftPage, Submission } from './types';
import { submissionEnvelope } from './types';
export type DraftQuery = {
  companyId?: string;
  branchId?: string;
  kind?: string;
  status?: string;
  view?: string;
  search?: string;
  attentionRejected?: boolean;
  page?: number;
  limit?: number;
};
export const getDrafts = (query: DraftQuery, signal?: AbortSignal) =>
  backendGet<DraftPage>('/pos-drafts', { query, signal });
export const getDraft = (id: string, signal?: AbortSignal) =>
  backendGet<Draft>(`/pos-drafts/${encodeURIComponent(id)}`, { signal });
export const getDraftContext = (
  query: { companyId?: string; branchId?: string },
  signal?: AbortSignal,
) => backendGet<DraftContext>('/pos-drafts/context', { query, signal });
export const submitDraft = (body: Submission) =>
  backendPost<Draft>('/pos-drafts', submissionEnvelope(body));
export const decideDraft = (
  id: string,
  action: Exclude<DraftAction, 'correct'>,
  body: {
    revision: number;
    reason?: string;
    duplicateReason?: string;
    reviewedCandidateIds?: string[];
    fundsReturned?: boolean;
    reference?: string;
  },
) => backendPost<Draft>(`/pos-drafts/${encodeURIComponent(id)}/${action}`, body);
