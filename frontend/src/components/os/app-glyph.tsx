import { AppIcon } from '@/components/ui/icon-set';
import type { WorkspaceApp } from '@/lib/apps';
import './app-glyph.css';

/** The same app identity appears in the desktop, dock and app switcher. */
export function AppGlyph({
  app,
  size = 'medium',
}: {
  app: WorkspaceApp;
  size?: 'small' | 'medium' | 'large';
}) {
  return (
    <span className={`os-glyph os-glyph-${size}`} data-app={app.id} aria-hidden="true">
      <AppIcon
        name={app.icon}
        size={size === 'large' ? 33 : size === 'small' ? 19 : 26}
        strokeWidth={1.65}
      />
    </span>
  );
}
