// Core layout & display
export { PageHeader } from './page-header';
export { Card } from './card';
export { StatCard } from './stat-card';
export type { StatCardTrend } from './stat-card';
export { StatusBadge } from './status-badge';

// Data
export { DataTable } from './data-table';
export type { Column } from './data-table';

// State
export { EmptyState } from './empty-state';
export { LoadingState, PageSpinner } from './loading-state';
export {
  Skeleton,
  SkeletonText,
  SkeletonCard,
  SkeletonCardGrid,
  SkeletonTable,
} from './skeleton';
export { ErrorState } from './error-state';
export { PermissionDeniedState } from './permission-denied-state';

// Overlays
export { ConfirmDialog } from './confirm-dialog';
export { DetailDrawer } from './detail-drawer';
export { Modal } from './modal';

// Access control
export { PermissionGate } from './permission-gate';
export { ScopeSelector, scopeToQueryString } from './scope-selector';
export type { ScopeValue } from './scope-selector';

// Forms
export { FormInput, FormSelect, FormTextarea, DateInput, FileUpload } from './forms';

// Buttons
export { Btn, IconBtn } from './btn';

// Layout helpers
export { PageToolbar, SectionHeader } from './page-toolbar';

// Audit
export { AuditTimeline } from './audit-timeline';

// Theme
export { ThemeSelector } from './theme-selector';

// Feedback — re-exported from the (already-mounted) aurora toast system so
// pages have a single import surface for showing success/error toasts.
export { showToast } from '@/components/aurora/feedback';
