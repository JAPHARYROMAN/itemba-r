import React from 'react';

export interface ApprovalStep {
  id: string;
  stepNumber: number;
  title: string;
  description?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED';
  approver?: string;
  actionedAt?: string;
  comment?: string;
}

interface ApprovalTimelineProps {
  steps: ApprovalStep[];
  className?: string;
}

const STEP_STYLES: Record<string, { bg: string; text: string; border: string; icon: React.ReactNode }> = {
  PENDING: {
    bg: 'var(--aurora-bg-muted)',
    text: 'var(--aurora-text-muted)',
    border: 'var(--aurora-border)',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
      </svg>
    ),
  },
  APPROVED: {
    bg: 'var(--aurora-success)',
    text: '#fff',
    border: 'var(--aurora-success)',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path d="M20 6 9 17l-5-5"/>
      </svg>
    ),
  },
  REJECTED: {
    bg: 'var(--aurora-danger)',
    text: '#fff',
    border: 'var(--aurora-danger)',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path d="M18 6 6 18M6 6l12 12"/>
      </svg>
    ),
  },
  SKIPPED: {
    bg: 'var(--aurora-bg-muted)',
    text: 'var(--aurora-text-muted)',
    border: 'var(--aurora-border)',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path d="M5 12h14m-7-7 7 7-7 7"/>
      </svg>
    ),
  },
};

export function ApprovalTimeline({ steps, className = '' }: ApprovalTimelineProps) {
  return (
    <div className={`space-y-0 ${className}`}>
      {steps.map((step, index) => {
        const s = STEP_STYLES[step.status] ?? STEP_STYLES.PENDING;
        const badgeBg = s.text === '#fff' ? `${s.border}20` : s.bg;
        const badgeColor = s.text === '#fff' ? s.border : s.text;
        return (
          <div key={step.id} className="relative flex gap-4">
            <div className="flex flex-col items-center">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: s.bg, color: s.text, border: `2px solid ${s.border}` }}
              >
                {s.icon}
              </div>
              {index < steps.length - 1 && (
                <div className="w-px flex-1 mt-1 mb-1" style={{ background: 'var(--aurora-border)', minHeight: '20px' }} />
              )}
            </div>
            <div className="pb-5 flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider mr-2" style={{ color: 'var(--aurora-text-muted)' }}>
                    Step {step.stepNumber}
                  </span>
                  <span className="text-sm font-medium" style={{ color: 'var(--aurora-text)' }}>{step.title}</span>
                </div>
                <span
                  className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: badgeBg, color: badgeColor, border: `1px solid ${s.border}` }}
                >
                  {step.status}
                </span>
              </div>
              {step.approver && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>Approver: {step.approver}</p>
              )}
              {step.comment && (
                <div
                  className="mt-2 p-2 rounded-lg text-xs italic"
                  style={{ background: 'var(--aurora-bg-subtle)', color: 'var(--aurora-text-secondary)', border: '1px solid var(--aurora-border)' }}
                >
                  &ldquo;{step.comment}&rdquo;
                </div>
              )}
              {step.actionedAt && (
                <p className="text-xs mt-1" style={{ color: 'var(--aurora-text-muted)' }}>{step.actionedAt}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
