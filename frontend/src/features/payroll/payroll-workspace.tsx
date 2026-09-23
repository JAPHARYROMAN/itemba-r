'use client';
import type { ReactNode } from 'react';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { useWorkspacePathname as usePathname } from '@/components/workspace/workspace-navigation';
import { AppGlyph } from '@/components/os/app-glyph';
import { getApp } from '@/lib/apps';
import { useAuth } from '@/hooks/use-auth';
import { PermissionDeniedState } from '@/components/ui';
import { useWorkspaceRouter as useGuardedRouter } from '@/components/workspace/workspace-navigation';
import { PAYROLL_APP_PERMISSIONS, PAYROLL_TABS, activePayrollTab } from '@/lib/payroll-app';
import { PayrollDraftWorkspace } from './payroll-drafts';
import './payroll.css';

export function PayrollWorkspace({ children }: { children: ReactNode }) {
  const { hasPermission } = useAuth(),
    pathname = usePathname();
  const router = useGuardedRouter();
  const tabs = PAYROLL_TABS.filter((t) => t.permissions.some((p) => hasPermission(p)));
  const groups = [...new Set(tabs.map((t) => t.group))];
  if (!PAYROLL_APP_PERMISSIONS.some((p) => hasPermission(p)))
    return (
      <PermissionDeniedState description="Ask your administrator for Payroll access to open this app." />
    );
  return (
    <div className="payroll-app payroll-suite">
      <aside className="payroll-suite-sidebar">
        <Link href="/payroll" className="payroll-identity" aria-label="Payroll home">
          <AppGlyph app={getApp('payroll')!} size="small" />
          <strong>
            Payroll<small>People & pay</small>
          </strong>
        </Link>
        <nav aria-label="Payroll workspace">
          {groups.map((group) => (
            <div className="payroll-nav-group" key={group}>
              <p>{group}</p>
              {tabs
                .filter((t) => t.group === group)
                .map((t) => (
                  <Link
                    key={t.href}
                    href={t.href}
                    aria-current={activePayrollTab(pathname) === t.href ? 'page' : undefined}
                  >
                    {t.label}
                  </Link>
                ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="payroll-suite-body">
        <label className="payroll-mobile-nav">
          <span>Payroll · People & pay</span>
          <select
            aria-label="Payroll section"
            value={activePayrollTab(pathname)}
            onChange={(e) => router.push(e.target.value)}
          >
            {groups.map((group) => (
              <optgroup label={group} key={group}>
                {tabs
                  .filter((t) => t.group === group)
                  .map((t) => (
                    <option value={t.href} key={t.href}>
                      {t.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <PayrollDraftWorkspace viewKey={pathname}>{children}</PayrollDraftWorkspace>
      </div>
    </div>
  );
}
