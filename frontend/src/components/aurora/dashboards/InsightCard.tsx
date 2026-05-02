import React from 'react';

interface InsightCardProps {
  insightNumber?: string;
  title: string;
  summary: string;
  severity: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  insightType: string;
  status: string;
  date?: string;
  onAcknowledge?: () => void;
  className?: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  LOW: '#10b981', NORMAL: '#06b6d4', HIGH: '#f59e0b', CRITICAL: '#ef4444',
};

export function InsightCard({ insightNumber, title, summary, severity, insightType, status, date, onAcknowledge, className = '' }: InsightCardProps) {
  const color = SEVERITY_COLOR[severity] ?? '#94a3b8';
  return (
    <div className={`rounded-aurora border p-5 ${className}`}
      style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)', boxShadow: 'var(--aurora-shadow-sm)' }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--aurora-text-muted)' }}>
            {insightType.replace(/_/g, ' ')}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: color + '20', color: color }}>
            {severity}
          </span>
        </div>
      </div>
      <h4 className="text-sm font-semibold mb-1.5" style={{ color: 'var(--aurora-text)' }}>{title}</h4>
      <p className="text-xs line-clamp-2" style={{ color: 'var(--aurora-text-secondary)' }}>{summary}</p>
      <div className="flex items-center justify-between mt-4">
        {date && <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{date}</span>}
        {onAcknowledge && status === 'OPEN' && (
          <button onClick={onAcknowledge} className="text-xs font-medium px-3 py-1 rounded-lg transition-colors"
            style={{ background: 'var(--aurora-primary-subtle)', color: 'var(--aurora-primary)', border: '1px solid var(--aurora-border)' }}>
            Acknowledge
          </button>
        )}
      </div>
    </div>
  );
}
