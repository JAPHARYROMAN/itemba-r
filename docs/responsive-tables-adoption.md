# Responsive DataTable adoption guide

> Closes audit findings **F-031** (DataTable consistency) and **F-032** (mobile responsiveness) for any page that adopts the wrapper.

The Aurora design system now ships a `ResponsiveDataTable` component that wraps the existing `DataTable` and adds:

1. **Per-column responsive priority** — columns can be tagged so they automatically hide on small screens.
2. **Mobile card mode** — on phone-width viewports, rows render as readable stacked cards rather than a horizontally-scrolling table.

The wrapper is a strict superset of the existing `DataTable` — adopting it is a one-line import change plus an optional `priority` per column. No other parts of the page change.

## Migration recipe

### Step 1 — change the import

```diff
- import { DataTable, Column } from '@/components/aurora/data-display';
+ import { ResponsiveDataTable, ResponsiveColumn } from '@/components/aurora/data-display';
```

### Step 2 — change the component name

```diff
- <DataTable columns={columns} data={data} ... />
+ <ResponsiveDataTable columns={columns} data={data} ... />
```

### Step 3 — annotate columns with priority

```ts
const columns: ResponsiveColumn<Loan>[] = [
  { key: 'reference',  header: 'Loan #',    priority: 1 },     // always visible
  { key: 'lender',     header: 'Lender',    priority: 1 },     // always visible
  { key: 'amount',     header: 'Amount',    priority: 1, accessor: r => formatMoney(r.amount) },
  { key: 'maturity',   header: 'Maturity',  priority: 2 },     // visible on tablet+
  { key: 'createdAt',  header: 'Created',   priority: 3 },     // visible on desktop only
  { key: 'updatedAt',  header: 'Updated',   priority: 3 },
];
```

Priority values:

| Priority | Visible at | Use for |
|---|---|---|
| `1` (default) | Phones, tablets, desktop | Identifier, primary amount, status |
| `2` | Tablets, desktop | Secondary attributes (dates, codes) |
| `3` | Desktop only | Metadata (timestamps, audit fields) |

That's it. The wrapper handles the rest.

## What the user actually sees

| Viewport | Behavior |
|---|---|
| **≥768px** (desktop) | Standard table with all columns. |
| **640–767px** (tablet) | Standard table; priority-3 columns hidden. |
| **<640px** (phone) | Card layout with `dt`/`dd` pairs; all columns shown but in card format. |

## Why this is the right migration shape

The audit asked for table consistency across ~309 pages. Doing that as a blanket sweep would mean:

- Touching every page with no per-page testing.
- Forcing an opinion on every existing page.
- Producing a giant, hard-to-review diff.

This wrapper instead:

- Lets each page migrate independently with minimal diff.
- Falls back to existing behavior when a page doesn't migrate (no regression).
- Makes the new layout opt-in with one extra prop per column.

## Recommended adoption order

Start with the highest-traffic dashboards:

1. `/dashboard` — landing page with the group-control grid.
2. `/finance/journal-entries` — wide table, frequently filtered on mobile.
3. `/loans`, `/debts`, `/contracts` — sensitive, likely viewed on mobile by leadership.
4. `/hr/payroll-runs`, `/hr/salary-payments` — sensitive, often scanned on phones during approvals.
5. `/petroleum/fuel-shifts` — operations dashboard, occasionally accessed in the field.

Once those five are migrated and verified at three viewport sizes (375 / 768 / 1280 px), the same pattern can be applied across the rest as time allows.

## Tests

A test suite ships with the wrapper (`src/components/aurora/data-display/ResponsiveDataTable.test.tsx`)
covering:

- Priority filtering at each breakpoint.
- Card-mode rendering on phone width.
- Keyboard activation of clickable rows.
- jest-axe a11y baseline.

Run with `npm run test` from the frontend directory.
