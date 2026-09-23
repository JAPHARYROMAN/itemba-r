'use client';
import { useEffect, useState } from 'react';
import { useWorkspaceSearchParams as useSearchParams } from '@/components/workspace/workspace-navigation';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceRouter as useGuardedRouter } from '@/components/workspace/workspace-navigation';
import { REPORTS } from './report-definitions';
import { localToday } from '@/features/invoice-desk/types';
type Saved = { id: string; name: string; href: string };
export function SavedReports() {
  const { user } = useAuth();
  return user?.id ? <SavedReportStore key={user.id} /> : null;
}
function SavedReportStore() {
  const { user, hasPermission } = useAuth(),
    params = useSearchParams(),
    router = useGuardedRouter();
  const [views, setViews] = useState<Saved[]>([]),
    [name, setName] = useState(''),
    [message, setMessage] = useState('');
  const key = user?.id ? `itemba-reports-views-v1:${user.id}` : '';
  useEffect(() => {
    setViews([]);
    if (!key) return;
    try {
      const data = JSON.parse(localStorage.getItem(key) || '[]');
      if (Array.isArray(data))
        setViews(
          data
            .filter(
              (v): v is Saved =>
                v &&
                typeof v.id === 'string' &&
                typeof v.name === 'string' &&
                typeof v.href === 'string' &&
                (v.href === '/reports' || v.href.startsWith('/reports?')),
            )
            .slice(0, 20),
        );
    } catch {
      setMessage('Saved reports could not be loaded.');
    }
  }, [key]);
  const allowed = (href: string) => {
    const view = new URLSearchParams(href.split('?')[1]).get('view');
    if (view === 'accounting') return hasPermission('journal_entries.view');
    if (view === 'health')
      return ['sales_desk.view', 'invoice_desk.view', 'cash_desk.view', 'loans.read'].some(
        (permission) => hasPermission(permission),
      );
    const report = REPORTS.find((r) => r.id === view);
    return !view || (!!report && hasPermission(report.permission));
  };
  function persist(next: Saved[]) {
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setViews(next);
      setMessage('');
      return true;
    } catch {
      setMessage('This browser could not save the report.');
      return false;
    }
  }
  if (!key) return null;
  return (
    <details className="saved-reports">
      <summary>
        Saved reports <span>{views.filter((v) => allowed(v.href)).length}</span>
      </summary>
      <p>
        Keep frequently used filters in this browser for your account. Dates are saved as selected.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          if (views.length >= 20) {
            setMessage('You can save up to 20 reports. Remove one first.');
            return;
          }
          const selected = new URLSearchParams(params.toString());
          if (selected.get('view') !== 'loans') {
            const end = selected.get('to') || localToday();
            selected.set('to', end);
            selected.set('from', selected.get('from') || `${end.slice(0, 7)}-01`);
          }
          const query = selected.toString();
          if (
            persist([
              ...views,
              {
                id: crypto.randomUUID(),
                name: name.trim().slice(0, 60),
                href: query ? `/reports?${query}` : '/reports',
              },
            ])
          )
            setName('');
        }}
      >
        <input
          aria-label="Saved report name"
          placeholder="e.g. Monthly branch review"
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" disabled={!name.trim()}>
          Save this view
        </button>
      </form>
      <ul>
        {views
          .filter((v) => allowed(v.href))
          .map((v) => (
            <li key={v.id}>
              <button onClick={() => router.push(v.href)}>{v.name}</button>
              <button
                aria-label={`Remove saved report ${v.name}`}
                onClick={() => persist(views.filter((item) => item.id !== v.id))}
              >
                Remove
              </button>
            </li>
          ))}
      </ul>
      {message && <p role="status">{message}</p>}
    </details>
  );
}
