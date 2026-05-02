import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HARDENED_OPERATION_PAGES = [
  'src/app/(dashboard)/operations/page.tsx',
  'src/app/(dashboard)/operations/customers/page.tsx',
  'src/app/(dashboard)/operations/inventory-balances/page.tsx',
  'src/app/(dashboard)/operations/inventory-locations/page.tsx',
  'src/app/(dashboard)/operations/inventory-movements/page.tsx',
  'src/app/(dashboard)/operations/product-categories/page.tsx',
  'src/app/(dashboard)/operations/products/page.tsx',
  'src/app/(dashboard)/operations/purchase-orders/page.tsx',
  'src/app/(dashboard)/operations/reports/page.tsx',
  'src/app/(dashboard)/operations/sales-orders/page.tsx',
  'src/app/(dashboard)/operations/stock-adjustments/page.tsx',
  'src/app/(dashboard)/operations/suppliers/page.tsx',
  'src/app/(dashboard)/operations/units/page.tsx',
];

const HARDENED_JOB_BACKUP_PAGES = [
  'src/app/(dashboard)/background-jobs/page.tsx',
  'src/app/(dashboard)/background-jobs/queues/page.tsx',
  'src/app/(dashboard)/backups/page.tsx',
  'src/app/(dashboard)/backups/jobs/page.tsx',
  'src/app/(dashboard)/backups/runs/page.tsx',
  'src/app/(dashboard)/backups/restore-tests/page.tsx',
];

describe('frontend runtime safety', () => {
  it('keeps hardened pages on the safe backend client', () => {
    const offenders = [...HARDENED_OPERATION_PAGES, ...HARDENED_JOB_BACKUP_PAGES].flatMap(
      (relativePath) => {
        const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
        const issues: string[] = [];
        if (/\bfetch\s*\(/.test(source)) issues.push('raw fetch');
        if (/\.json\s*\(/.test(source)) issues.push('response json parse');
        return issues.map((issue) => `${relativePath}: ${issue}`);
      },
    );

    expect(offenders).toEqual([]);
  });
});
