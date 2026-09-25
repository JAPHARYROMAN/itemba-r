'use client';
import { ArrowLeft, ArrowRight, House } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useWindowNavigationTarget } from './window-navigation-context';
import { getApp } from '@/lib/apps';
import { useWorkspaceHistory, WorkspaceLink } from '@/components/workspace/workspace-navigation';
import './os-navigable-app.css';

/** The same navigation and keyboard targets in every hosted app. */
export function AppNavigation({ appId }: { appId: string }) {
  const history = useWorkspaceHistory();
  const app = getApp(appId);
  const target = useWindowNavigationTarget();
  if (!history || !app) return null;
  const url = new URL(history.href, 'http://desktop.local');
  const view =
    (url.searchParams.get('view') ??
      url.searchParams.get('tab') ??
      url.pathname.split('/').slice(2).join(' / ')) ||
    'Home';
  const home = ['invoice-desk', 'cash-desk', 'sales-desk', 'records'].includes(appId)
    ? `${app.href}?view=overview`
    : app.href;
  const navigation = (
    <nav className="os-app-history" aria-label={`${app.label} navigation`}>
      <button
        type="button"
        aria-label={`Back in ${app.label}`}
        title="Back"
        disabled={!history.canBack}
        onClick={history.back}
      >
        <ArrowLeft size={16} />
      </button>
      <button
        type="button"
        aria-label={`Forward in ${app.label}`}
        title="Forward"
        disabled={!history.canForward}
        onClick={history.forward}
      >
        <ArrowRight size={16} />
      </button>
      <WorkspaceLink href={home} aria-label={`${app.label} home`} title={`${app.label} home`}>
        <House size={16} />
      </WorkspaceLink>
      <span className="os-app-location" aria-live="polite">
        {view.replaceAll('-', ' ')}
      </span>
    </nav>
  );
  return target ? createPortal(navigation, target) : navigation;
}
