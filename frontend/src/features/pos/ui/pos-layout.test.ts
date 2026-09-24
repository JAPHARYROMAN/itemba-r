import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// jsdom cannot lay out, so this guards the rules themselves. Without them the
// tablet and till panels grew as tall as the product list, the page scrolled,
// and Lipa / Maliza Mauzo sat below the fold (UI review finding 25).
describe('POS sale screen fits the viewport on tablet and till', () => {
  const css = readFileSync(join(__dirname, 'pos-app.css'), 'utf8');
  const block = css.slice(css.indexOf('Tablet and till: the sale screen fits the viewport'));

  it('gives the sale screen the viewport height', () => {
    expect(block).toMatch(/\.pos-app:has\(> \.pos-body\) \{\s+height: 100dvh;/);
  });

  it('scrolls the product list and cart lines inside their panels', () => {
    expect(block).toMatch(
      /\.pos-body \{\s+grid-template-rows: minmax\(0, 1fr\);\s+overflow: hidden;/,
    );
    expect(block).toMatch(/\.pos-products\[data-mode='results'\] \{[^}]*overflow-y: auto;/);
    expect(block).toMatch(/\.pos-lines \{[^}]*overflow-y: auto;/);
  });

  it('keeps the finishing button pinned inside the payment panel', () => {
    expect(block).toMatch(/\.pos-pay > \.pos-btn-primary \{\s+position: sticky;\s+bottom: 0;/);
  });
});
