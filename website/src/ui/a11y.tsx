import type { ReactNode } from 'react';

/** Text for assistive technology only. */
export function VisuallyHidden({ as: Tag = 'span', children }: { as?: 'span' | 'div' | 'h2' | 'h3'; children: ReactNode }) {
  return <Tag className="sr-only">{children}</Tag>;
}

/**
 * The first focusable element on every page: jumps to `<main id="main-content">`.
 * Styled by `.skip-link` in src/styles/base.css (hidden until focused).
 */
export function SkipLink({ target = 'main-content', children }: { target?: string; children: ReactNode }) {
  return (
    <a href={`#${target}`} className="skip-link">
      {children}
    </a>
  );
}
