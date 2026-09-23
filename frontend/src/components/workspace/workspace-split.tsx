'use client';
import { Children, useEffect, useRef, type ReactNode } from 'react';
import './workspace-split.css';

/** Keep the inspector beside the list on large screens and open it as a focused view on phones. */
export function WorkspaceSplit({
  children,
  selectedKey,
  onClose,
}: {
  children: ReactNode;
  selectedKey?: string | null;
  onClose: () => void;
}) {
  const [list, details] = Children.toArray(children);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!selectedKey) return;
    opener.current = document.activeElement as HTMLElement | null;
    heading.current?.focus();
  }, [selectedKey]);
  return (
    <div className={`os-workspace-split ${selectedKey ? 'has-selection' : ''}`}>
      <section className="os-split-list" aria-label="Records">
        {list}
      </section>
      <aside className="os-split-detail" aria-label="Record details">
        {selectedKey && (
          <header>
            <h2 ref={heading} tabIndex={-1}>
              Record details
            </h2>
            <button
              type="button"
              onClick={() => {
                onClose();
                requestAnimationFrame(() => opener.current?.focus());
              }}
            >
              Back to list
            </button>
          </header>
        )}
        {details}
      </aside>
    </div>
  );
}
