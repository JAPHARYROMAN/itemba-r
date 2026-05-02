# ITEMBA-R Aurora Design System

Version 1.0 — Built for ITEMBA-R Group Digital Governance Platform

---

## Design Philosophy

Aurora is inspired by three design paradigms:

- **Apple** — Premium minimalism, elegant whitespace, smooth polish, refined typography
- **Microsoft** — Enterprise productivity, excellent tables, practical dashboards, keyboard-friendly
- **Tesla** — Futuristic command-center feel, real-time dashboards, dark mode excellence

The system makes ITEMBA-R feel like a **business operating system** — not a generic ERP template.

---

## Technology Stack

- Next.js 14 (App Router)
- TypeScript 5.5
- Tailwind CSS 3.4 (`darkMode: 'class'`)
- Pure React — no external UI library

---

## Theme System

### Modes
- `light` — Soft white backgrounds, graphite text, electric blue primary
- `dark` — Deep graphite backgrounds, soft white text, electric blue primary
- `system` — Follows OS preference

### Usage
```typescript
import { initTheme, applyTheme, ThemeMode } from '@/lib/design-system/theme';

// Initialize (call once on mount in dashboard layout)
initTheme();

// Programmatically change
applyTheme('dark');
```

### Theme Toggle Component
```tsx
import { ThemeToggle } from '@/components/aurora/navigation';
<ThemeToggle />
```

Preference is stored in `localStorage` under the key `aurora-theme`.

---

## Design Tokens

All tokens are CSS variables defined in `src/styles/aurora.css` (via `globals.css`).

### Color Tokens
| Token | Usage |
|-------|-------|
| `--aurora-bg` | Page background |
| `--aurora-card` | Card/panel background |
| `--aurora-bg-subtle` | Subtle background (hover, inputs) |
| `--aurora-bg-muted` | Muted background (badges, chips) |
| `--aurora-border` | Default border color |
| `--aurora-text` | Primary text |
| `--aurora-text-secondary` | Secondary / label text |
| `--aurora-text-muted` | Muted / helper text |
| `--aurora-primary` | Brand / action blue |
| `--aurora-primary-subtle` | Tinted primary bg |
| `--aurora-success` | Success green |
| `--aurora-warning` | Warning amber |
| `--aurora-danger` | Danger red |
| `--aurora-info` | Info blue/cyan |

### Shadow Tokens
| Token | Usage |
|-------|-------|
| `--aurora-shadow-sm` | Card shadow |
| `--aurora-shadow-md` | Elevated panel |
| `--aurora-shadow-lg` | Modal/overlay |
| `--aurora-shadow-command` | Command palette |

### JS Token Reference
```typescript
import { AURORA_TOKENS } from '@/lib/design-system';
```

---

## File Structure

```
frontend/src/
  components/aurora/
    layout/          → AuroraPage, AuroraPageHeader, AuroraSection, AuroraCard
                       AuroraToolbar
    actions/         → AuroraButton
    navigation/      → BreadcrumbTrail, ThemeToggle, CompanyContextSelector
    data-display/    → DataTable, StatusBadge, DetailList, RecordHeader
    dashboards/      → StatCard, MetricCard, SummaryGrid, AlertCard, InsightCard, CommandCenterPanel
    feedback/        → EmptyState, LoadingState, ErrorState, RestrictedDataState, Toast
    overlays/        → Modal, Drawer, ConfirmDialog
    forms/           → FormShell, FormSection, FormInput, FormSelect, FormTextarea,
                       FormDateInput, FormCurrencyInput, FormCheckbox, FormSwitch, FormActions
    timelines/       → ActivityTimeline, ApprovalTimeline, AuditTimeline
    command/         → CommandPalette, CommandPaletteProvider, GlobalSearchBox
    charts/          → ChartCard, MiniTrendLine, ProgressRing
  lib/design-system/
    tokens.ts        → JS token constants
    formatters.ts    → formatMoney, formatDate, formatDateTime, formatNumber, etc.
    status.ts        → StatusVariant, getStatusVariant, STATUS_CLASSES, etc.
    permissions.ts   → hasPermission, maskSensitiveValue, SENSITIVE_PERMISSIONS
    navigation.ts    → NavItem, NavSection, BreadcrumbItem, buildBreadcrumbs
    theme.ts         → ThemeMode, initTheme, applyTheme (has 'use client')
    index.ts         → Barrel export (all except theme.ts)
  styles/
    globals.css      → CSS variable definitions, utility classes
```

---

## Core Components

### Action Components

#### `AuroraButton`
Standard action button for commands, refresh, submit, retry, and destructive actions.
```tsx
<AuroraButton variant="primary" size="md">Save</AuroraButton>
<AuroraButton variant="secondary" size="sm">Refresh</AuroraButton>
<AuroraButton variant="danger">Delete</AuroraButton>
```

Use `loading` for in-flight actions and `disabled` when the action is unavailable.

### Layout Components

#### `AuroraPage`
Page wrapper with consistent padding and background.
```tsx
<AuroraPage>
  {/* page content */}
</AuroraPage>
```

#### `AuroraPageHeader`
Standard page header with title, subtitle, eyebrow, and actions.
```tsx
<AuroraPageHeader
  title="Group Control"
  subtitle="Sensitive financial oversight"
  eyebrow="Group Level"
  actions={<button>Export</button>}
/>
```

#### `AuroraToolbar`
Standard operator toolbar for page refresh, filters, data freshness, and compact context.
```tsx
<AuroraToolbar
  title="Executive operating rhythm"
  description="Live session and dashboard freshness"
  meta={<StatusBadge status="ACTIVE" size="sm" />}
  actions={<AuroraButton size="sm">Refresh</AuroraButton>}
/>
```

Use this instead of hand-rolled action rows on new pages.

#### `AuroraSection`
Section container with optional title.
```tsx
<AuroraSection title="Overview" actions={<Link>View All</Link>}>
  {/* section content */}
</AuroraSection>
```

#### `AuroraCard`
Standard card container.
```tsx
<AuroraCard className="p-5">
  {/* card content */}
</AuroraCard>
```

---

### Dashboard Components

#### `StatCard`
KPI stat card with value, title, and optional trend.
```tsx
<StatCard
  title="Active Loans"
  value={12}
  subtitle="2 overdue"
  variant="warning"
  trend={{ value: '+2', direction: 'up', label: 'vs last month' }}
/>
```

#### `MetricCard`
Richer metric card with description and sparkline support.
```tsx
<MetricCard
  title="Revenue"
  value="TZS 4.2M"
  description="Month to date"
  trend={{ value: '+8%', direction: 'up' }}
/>
```

#### `SummaryGrid`
Responsive grid wrapper for stat cards.
```tsx
<SummaryGrid cols={4}>
  <StatCard ... />
  <StatCard ... />
</SummaryGrid>
```

#### `AlertCard`
Alert panel with severity and items list.
```tsx
<AlertCard
  title="Expiring Contracts (3)"
  severity="warning"
  items={[
    { id: '1', title: 'Supplier Agreement', description: 'Expires in 12 days', severity: 'warning' }
  ]}
/>
```

#### `CommandCenterPanel`
Executive command center panel with header and flexible content.
```tsx
<CommandCenterPanel title="Operations Status">
  {/* panels */}
</CommandCenterPanel>
```

---

### Data Display

#### `DataTable`
Full-featured enterprise data table.
```tsx
<DataTable
  columns={[
    { key: 'name', header: 'Name' },
    { key: 'status', header: 'Status', render: (v) => <StatusBadge status={v as string} /> },
  ]}
  data={rows}
  keyField="id"
  searchable
  sortable
  paginated
  compact
/>
```

#### `StatusBadge`
Status badge with consistent color language.
```tsx
<StatusBadge status="APPROVED" variant="success" size="sm" />
<StatusBadge status="OVERDUE" variant="danger" />
<StatusBadge status="PENDING" variant="warning" size="lg" />
```

Status variant helper:
```typescript
import { getStatusVariant } from '@/lib/design-system';
const variant = getStatusVariant('APPROVED'); // → 'success'
```

#### `DetailList`
Labeled key-value detail list.
```tsx
<DetailList
  items={[
    { label: 'Company', value: 'Mwanjalisi Oil' },
    { label: 'Status', value: <StatusBadge status="ACTIVE" variant="success" /> },
  ]}
  columns={2}
/>
```

---

### Form Components

#### Pattern
```tsx
<FormShell onSubmit={handleSubmit}>
  <FormSection title="Basic Info" description="Core company details" columns={2}>
    <FormInput label="Company Name" required error={errors.name} />
    <FormSelect label="Status" options={statusOptions} required />
  </FormSection>
  <FormSection title="Contact" columns={2}>
    <FormInput label="Email" type="email" />
    <FormInput label="Phone" type="tel" />
  </FormSection>
  <FormActions primaryLabel="Save Company" onSecondary={onCancel} loading={saving} />
</FormShell>
```

#### `FormCurrencyInput`
```tsx
<FormCurrencyInput
  label="Loan Amount"
  currency="TZS"
  required
  value={amount}
  onChange={e => setAmount(e.target.value)}
/>
```

#### `FormSwitch`
```tsx
<FormSwitch
  label="Send Notifications"
  checked={notify}
  onChange={setNotify}
  help="Send email alerts on status changes"
/>
```

---

### Feedback Components

#### `EmptyState`
```tsx
<EmptyState
  title="No Records Found"
  description="Start by creating your first contract."
  action={{ label: 'Create Contract', onClick: () => {} }}
/>
```

#### `LoadingState`
```tsx
<LoadingState title="Loading contracts…" />
```

#### `ErrorState`
```tsx
<ErrorState
  title="Failed to Load"
  description="The API returned an error."
  action={{ label: 'Retry', onClick: refetch }}
/>
```

#### `RestrictedDataState`
```tsx
<RestrictedDataState requiredPermission="Group Control View" />
```

#### Toast
```tsx
import { showToast } from '@/components/aurora/feedback';

showToast({ message: 'Contract saved', type: 'success' });
showToast({ message: 'Failed to save', type: 'error' });
```

`ToastProvider` must be rendered in the dashboard layout.

---

### Overlay Components

#### `Modal`
```tsx
<Modal open={isOpen} onClose={onClose} title="Confirm Action" size="md">
  <p>Are you sure?</p>
</Modal>
```

#### `Drawer`
```tsx
<Drawer open={isOpen} onClose={onClose} title="Contract Details" side="right">
  <DetailList items={...} />
</Drawer>
```

#### `ConfirmDialog`
```tsx
<ConfirmDialog
  open={isOpen}
  onClose={onClose}
  onConfirm={handleDelete}
  title="Delete Contract"
  description="This action cannot be undone."
  confirmLabel="Delete"
  variant="danger"
/>
```

---

### Timeline Components

#### `AuditTimeline`
```tsx
import { AuditTimeline } from '@/components/aurora/timelines';
<AuditTimeline entries={auditLogs} />
```

#### `ApprovalTimeline`
```tsx
import { ApprovalTimeline } from '@/components/aurora/timelines';
<ApprovalTimeline steps={approvalSteps} />
```

#### `ActivityTimeline`
```tsx
import { ActivityTimeline } from '@/components/aurora/timelines';
<ActivityTimeline
  events={[
    { id: '1', title: 'Contract Created', timestamp: '2 hours ago', type: 'success' }
  ]}
/>
```

---

### Command Palette

Keyboard shortcut: **Ctrl+K** / **Cmd+K**

Setup in dashboard layout:
```tsx
import { CommandPaletteProvider } from '@/components/aurora/command';

<CommandPaletteProvider>
  {children}
</CommandPaletteProvider>
```

Programmatic open:
```tsx
import { useCommandPalette } from '@/components/aurora/command';
const { open } = useCommandPalette();
```

---

### Chart Components

#### `ProgressRing`
Pure SVG ring/donut chart — no library needed.
```tsx
<ProgressRing value={72} size={80} label="72%" sublabel="capacity" />
```

#### `MiniTrendLine`
Pure SVG sparkline.
```tsx
<MiniTrendLine data={[10, 14, 12, 18, 22, 20, 25]} width={100} height={32} />
```

#### `ChartCard`
Chart container card.
```tsx
<ChartCard
  title="Monthly Revenue"
  value="TZS 42M"
  subtitle="Last 6 months"
  height={200}
  chart={<MiniTrendLine data={revenue} width={400} height={160} />}
/>
```

---

## Formatters

```typescript
import { formatMoney, formatDate, formatDateTime, formatNumber, formatPercent } from '@/lib/design-system';

formatMoney(1234567, 'TZS')  // → 'TZS 1,234,567'
formatDate('2024-01-15')     // → '15 Jan 2024'
formatDateTime('2024-01-15T10:30:00') // → '15 Jan 2024, 10:30'
formatNumber(1234567)        // → '1,234,567'
formatPercent(0.72)          // → '72.0%'
```

---

## Status Language

| Status | Variant | Usage |
|--------|---------|-------|
| ACTIVE | success | Active records |
| INACTIVE | default | Inactive |
| DRAFT | secondary | Not yet submitted |
| PENDING | warning | Awaiting action |
| APPROVED | success | Approved |
| REJECTED | danger | Rejected |
| POSTED | info | Posted to ledger |
| PAID | success | Payment complete |
| OVERDUE | danger | Past due date |
| CANCELLED | default | Cancelled |
| CLOSED | secondary | Closed |
| COMPLETED | success | Fully complete |
| CRITICAL | danger | Requires immediate attention |
| RESTRICTED | secondary | No permission to view |

---

## Permission-Aware UI

```tsx
import { PermissionGate } from '@/components/ui/permission-gate';
import { RestrictedDataState } from '@/components/aurora/feedback';

// Gate entire sections
<PermissionGate permission="group-control.view">
  <SensitiveContent />
</PermissionGate>

// Show restricted state
{!canViewSensitive && <RestrictedDataState requiredPermission="Finance Sensitive View" />}
```

Sensitive values that must be masked when permission is missing:
- Salary / Payroll figures
- Bank account balances
- Loan outstanding balances
- Group consolidated P&L
- Tax filing amounts

---

## Module Visual Character

| Module | Feel |
|--------|------|
| Group Control | Serious, high-security, executive cards |
| Finance | Conservative, table-heavy, strong money formatting |
| Petroleum | Command-center, fuel stock panels, shift visibility |
| Westsides | Trading and POS friendly, stock and batch clarity |
| Itemba Enterprises | Divisional, logistics/agriculture/construction |
| Rentals | Occupancy cards, arrears visibility, lease timeline |
| Parking | Live occupancy, active sessions, fast check-in/out |
| Hospitality | Room status grid, booking calendar feel |
| HR | People-centered, sensitive payroll masking |
| Compliance | Calendar, deadlines, evidence, overdue warnings |
| BI | Executive polish, charts, dark mode command-center |

---

## Accessibility

- All interactive elements have visible focus states (via `.focus-aurora` CSS class)
- Icon-only buttons have `aria-label`
- Form inputs have associated `<label>` elements
- Error messages use `role="alert"` and `aria-describedby`
- Modals trap focus when open
- Animations respect `prefers-reduced-motion`
- Color is never the sole indicator of meaning (text labels + icons used alongside color)

---

## Adding New Pages

Use this pattern for new pages:

```tsx
'use client';
import { AuroraPage, AuroraPageHeader, AuroraSection } from '@/components/aurora';

export default function MyModulePage() {
  return (
    <AuroraPage>
      <AuroraPageHeader
        title="Module Name"
        subtitle="Brief description"
        actions={<button>Primary Action</button>}
      />
      <AuroraSection title="Overview">
        {/* content */}
      </AuroraSection>
    </AuroraPage>
  );
}
```
