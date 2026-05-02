import React from 'react';

interface AlertCardItem {
  id: string;
  title: string;
  description?: string;
  severity: 'info' | 'warning' | 'danger' | 'success';
  timestamp?: string;
  href?: string;
}

interface AlertCardProps {
  title?: string;
  items: AlertCardItem[];
  emptyText?: string;
  className?: string;
}

const ALERT_STYLES = {
  info: { bar: '#06b6d4', bg: 'var(--aurora-info-bg, #cffafe)' },
  warning: { bar: '#f59e0b', bg: 'var(--aurora-warning-bg, #fef3c7)' },
  danger: { bar: '#ef4444', bg: 'var(--aurora-danger-bg, #fee2e2)' },
  success: { bar: '#10b981', bg: 'var(--aurora-success-bg, #d1fae5)' },
};

export function AlertCard({ title = 'Alerts', items, emptyText = 'No active alerts', className = '' }: AlertCardProps) {
  return (
    <div className={`rounded-aurora border overflow-hidden ${className}`}
      style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)', boxShadow: 'var(--aurora-shadow-sm)' }}>
      <div className="px-5 py-3.5 border-b flex items-center justify-between" style={{ borderColor: 'var(--aurora-border)' }}>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>{title}</h3>
        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ background: items.length > 0 ? 'var(--aurora-danger-bg, #fee2e2)' : 'var(--aurora-bg-muted)', color: items.length > 0 ? 'var(--aurora-danger)' : 'var(--aurora-text-muted)' }}>
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>{emptyText}</div>
      ) : (
        <div className="divide-y" style={{ borderColor: 'var(--aurora-border)' }}>
          {items.map(item => {
            const s = ALERT_STYLES[item.severity];
            return (
              <div key={item.id} className="flex gap-3 px-5 py-3.5">
                <div className="w-0.5 rounded-full flex-shrink-0 self-stretch" style={{ background: s.bar, minHeight: '16px' }} />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--aurora-text)' }}>{item.title}</p>
                  {item.description && <p className="text-xs mt-0.5 line-clamp-1" style={{ color: 'var(--aurora-text-muted)' }}>{item.description}</p>}
                  {item.timestamp && <p className="text-xs mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>{item.timestamp}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
