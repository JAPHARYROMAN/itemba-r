import React from 'react';

export interface TimelineEvent {
  id: string;
  title: string;
  description?: string;
  timestamp: string;
  user?: string;
  type?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  icon?: React.ReactNode;
}

interface ActivityTimelineProps {
  events: TimelineEvent[];
  emptyText?: string;
  className?: string;
}

const TYPE_COLORS: Record<string, string> = {
  default: 'var(--aurora-text-muted)',
  success: 'var(--aurora-success)',
  warning: 'var(--aurora-warning)',
  danger: 'var(--aurora-danger)',
  info: 'var(--aurora-info)',
};

export function ActivityTimeline({ events, emptyText = 'No activity recorded', className = '' }: ActivityTimelineProps) {
  if (events.length === 0) {
    return (
      <p className="text-sm py-6 text-center" style={{ color: 'var(--aurora-text-muted)' }}>{emptyText}</p>
    );
  }

  return (
    <div className={`space-y-0 ${className}`}>
      {events.map((event, index) => {
        const color = TYPE_COLORS[event.type ?? 'default'];
        return (
          <div key={event.id} className="relative flex gap-4">
            <div className="flex flex-col items-center">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border"
                style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)', color }}
              >
                {event.icon ?? (
                  <div className="w-2 h-2 rounded-full" style={{ background: color }} />
                )}
              </div>
              {index < events.length - 1 && (
                <div className="w-px flex-1 mt-1 mb-1" style={{ background: 'var(--aurora-border)', minHeight: '20px' }} />
              )}
            </div>
            <div className="pb-5 min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium" style={{ color: 'var(--aurora-text)' }}>{event.title}</p>
                <span className="text-xs flex-shrink-0" style={{ color: 'var(--aurora-text-muted)' }}>{event.timestamp}</span>
              </div>
              {event.description && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--aurora-text-secondary)' }}>{event.description}</p>
              )}
              {event.user && (
                <p className="text-xs mt-1" style={{ color: 'var(--aurora-text-muted)' }}>by {event.user}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
