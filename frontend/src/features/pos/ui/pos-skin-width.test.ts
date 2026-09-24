import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// jsdom cannot evaluate media queries, so this guards the rule itself. Without
// it the modules in the OS skin were one 448px phone column in a till-wide
// window (UI review finding 28).
describe('Kaunta modules in the OS skin widen on tablet and till', () => {
  const css = readFileSync(join(__dirname, 'pos-app.css'), 'utf8');

  it('widens every module column, the rail and the slab together, from 900px', () => {
    expect(css).toMatch(
      /@media \(min-width: 900px\) \{\s+html \.pos-shell\[data-pos-skin='os'\] \.max-w-md \{\s+max-width: 48rem;/,
    );
  });
});
