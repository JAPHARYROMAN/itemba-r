'use client';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { PermissionDeniedState } from '@/components/ui';
import { PAYROLL_LEAVE, PAYROLL_ORGANISATION } from '@/lib/payroll-app';
export function PayrollPeopleTools({ kind }: { kind: 'leave' | 'organisation' }) {
  const { hasPermission } = useAuth();
  const items = (kind === 'leave' ? PAYROLL_LEAVE : PAYROLL_ORGANISATION).filter((x) =>
    hasPermission(x.permission),
  );
  if (!items.length)
    return <PermissionDeniedState description="Your role cannot view these employee tools." />;
  return (
    <div className="payroll-home">
      <header className="payroll-heading">
        <div>
          <p className="payroll-eyebrow">PEOPLE & PAY</p>
          <h1>{kind === 'leave' ? 'Leave management' : 'Your organisation'}</h1>
          <p>
            {kind === 'leave'
              ? 'Requests, balances and entitlements in one place.'
              : 'Set up teams and keep employee placements current.'}
          </p>
        </div>
      </header>
      <div className="payroll-input-grid">
        {items.map((x) => (
          <Link href={x.href} key={x.href}>
            <h2>
              {x.label}
              <ChevronRight size={16} />
            </h2>
            <p>{x.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
