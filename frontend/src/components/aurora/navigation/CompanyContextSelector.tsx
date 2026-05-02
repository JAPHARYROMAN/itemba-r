'use client';
import { useAuth } from '@/hooks/use-auth';

export function CompanyContextSelector() {
  const { user } = useAuth();

  // AuthUser has companyId; display it when present
  const companyId = user?.companyId;

  if (!companyId) {
    return (
      <div
        className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium"
        style={{
          background: 'var(--aurora-primary-subtle)',
          color: 'var(--aurora-primary-text)',
          border: '1px solid var(--aurora-border)',
        }}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
        <span>Group Level</span>
      </div>
    );
  }

  return (
    <div
      className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium"
      style={{
        background: 'var(--aurora-bg-subtle)',
        color: 'var(--aurora-text-secondary)',
        border: '1px solid var(--aurora-border)',
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
      <span>Company: {companyId}</span>
    </div>
  );
}
