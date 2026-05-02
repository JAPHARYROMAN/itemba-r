import React from 'react';

export interface AuditEntry {
  id: string;
  action: string;
  entityType?: string;
  entityId?: string;
  userId?: string;
  userEmail?: string;
  details?: Record<string, unknown>;
  createdAt: string;
  ipAddress?: string;
}

interface AuditTimelineProps {
  entries: AuditEntry[];
  emptyText?: string;
  className?: string;
}

export function AuditTimeline({ entries, emptyText = 'No audit records', className = '' }: AuditTimelineProps) {
  if (entries.length === 0) {
    return (
      <p className="text-sm py-6 text-center" style={{ color: 'var(--aurora-text-muted)' }}>{emptyText}</p>
    );
  }

  return (
    <div className={`space-y-0 ${className}`}>
      {entries.map((entry, index) => (
        <div key={entry.id} className="relative flex gap-4">
          <div className="flex flex-col items-center">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 border"
              style={{ background: 'var(--aurora-primary-subtle)', borderColor: 'var(--aurora-border)', color: 'var(--aurora-primary)' }}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
            </div>
            {index < entries.length - 1 && (
              <div className="w-px flex-1 mt-1 mb-1" style={{ background: 'var(--aurora-border)', minHeight: '16px' }} />
            )}
          </div>
          <div className="pb-4 flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="text-sm font-medium" style={{ color: 'var(--aurora-text)' }}>{entry.action}</span>
                {entry.entityType && (
                  <span
                    className="text-xs ml-2 px-1.5 py-0.5 rounded font-medium"
                    style={{ background: 'var(--aurora-bg-muted)', color: 'var(--aurora-text-secondary)' }}
                  >
                    {entry.entityType}
                  </span>
                )}
              </div>
              <span className="text-xs flex-shrink-0" style={{ color: 'var(--aurora-text-muted)' }}>{entry.createdAt}</span>
            </div>
            {entry.userEmail && (
              <p className="text-xs mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>
                {entry.userEmail}{entry.ipAddress ? ` · ${entry.ipAddress}` : ''}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
