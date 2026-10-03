import type { ReactNode } from 'react';

type RevealTag = 'div' | 'section' | 'li' | 'article' | 'figure' | 'ul' | 'ol' | 'p' | 'header' | 'footer' | 'aside';

/**
 * Marks a block for the entrance fade-up. It only adds `data-reveal`; the
 * motion lives in src/styles/utilities.css and runs on screen, under
 * prefers-reduced-motion: no-preference, where animation-timeline: view() is
 * supported. The server HTML carries no opacity or transform, so content is
 * always visible without JS, in print and in older browsers.
 *
 * Never wrap a hero or its LCP image.
 */
export function Reveal({ as: Tag = 'div', className, id, children }: { as?: RevealTag; className?: string; id?: string; children: ReactNode }) {
  return (
    <Tag data-reveal="" id={id} className={className}>
      {children}
    </Tag>
  );
}
