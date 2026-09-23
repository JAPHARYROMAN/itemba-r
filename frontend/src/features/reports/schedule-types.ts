import { ApiError } from '@/lib/api-client';

export type ScheduleFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | 'CUSTOM';
export type ReportExportFormat = 'PDF' | 'EXCEL' | 'CSV' | 'JSON' | 'DASHBOARD_ONLY';

export const FREQUENCY_OPTIONS: { value: ScheduleFrequency; label: string }[] = [
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'ANNUAL', label: 'Annual' },
  { value: 'CUSTOM', label: 'Custom' },
];

export const FORMAT_OPTIONS: { value: ReportExportFormat; label: string }[] = [
  { value: 'EXCEL', label: 'Excel (.xls)' },
  { value: 'PDF', label: 'PDF' },
  { value: 'CSV', label: 'CSV' },
  { value: 'JSON', label: 'JSON' },
  { value: 'DASHBOARD_ONLY', label: 'Dashboard only' },
];

export interface ScheduledReport extends Record<string, unknown> {
  id: string;
  scheduleCode: string;
  reportDefinitionId: string;
  savedReportViewId: string | null;
  companyId: string | null;
  name: string;
  description: string | null;
  frequency: ScheduleFrequency;
  scheduleConfig: Record<string, unknown> | null;
  recipients: Record<string, unknown> | null;
  exportFormat: ReportExportFormat;
  isActive: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledRun {
  id: string;
  reportRunNumber: string;
  status: string;
  rowCount: number | null;
  createdAt: string;
  completedAt: string | null;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  dataset: string | null;
  downloadable: boolean;
}

export interface ScheduleForm {
  scheduleCode: string;
  name: string;
  description: string;
  reportDefinitionId: string;
  savedReportViewId: string;
  companyId: string;
  frequency: ScheduleFrequency;
  exportFormat: ReportExportFormat;
  recipients: string; // comma / newline separated emails
}

export const EMPTY_FORM: ScheduleForm = {
  scheduleCode: '',
  name: '',
  description: '',
  reportDefinitionId: '',
  savedReportViewId: '',
  companyId: '',
  frequency: 'MONTHLY',
  exportFormat: 'EXCEL',
  recipients: '',
};

export const PAGE_LIMIT = 20;

export function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

/** Pull a readable list of recipient emails out of the stored JSON blob. */
export function recipientEmails(recipients: ScheduledReport['recipients']): string[] {
  if (!recipients) return [];
  const raw = recipients as Record<string, unknown>;
  const candidate = raw.emails ?? raw.to ?? raw.recipients ?? raw.addresses;
  if (Array.isArray(candidate)) return candidate.map((v) => String(v)).filter(Boolean);
  if (typeof candidate === 'string')
    return candidate
      .split(/[,\n;]/)
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

/** Parse the recipients textarea into the JSON shape the backend stores. */
export function parseRecipients(input: string): Record<string, unknown> {
  const emails = input
    .split(/[,\n;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { emails };
}

export interface ScheduleOptions {
  companies: { id: string; name: string }[];
  reports: { id: string; name: string; snapshotSupported: boolean }[];
  canUseGroupScope: boolean;
  canUseSavedViews: boolean;
}
export interface SavedScheduleView {
  id: string;
  name: string;
  companyId: string | null;
  reportDefinitionId: string;
}
