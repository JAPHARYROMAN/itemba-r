import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { accentFocus, accentForeground, contrastRatio } from './desktop';
describe('Desktop colour readability', () => {
  it('keeps all shared text tokens above 4.5:1 on the solid app surfaces', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/os/os-foundation.css'), 'utf8');
    const light = css.slice(css.indexOf('.itemba-os,'), css.indexOf('.dark .itemba-os,'));
    const dark = css.slice(
      css.indexOf('.dark .itemba-os,'),
      css.indexOf('.itemba-os[data-backdrop'),
    );
    for (const source of [light, dark]) {
      const token = (name: string) =>
        new RegExp('--aurora-' + name + ': (#[a-f0-9]+);').exec(source)![1];
      for (const text of ['text', 'text-secondary', 'text-muted'])
        for (const surface of ['bg', 'bg-subtle', 'card'])
          expect(
            contrastRatio(token(text), token(surface)),
            text + ' on ' + surface,
          ).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('keeps extreme custom accents readable and their focus rings visible', () => {
    for (const accent of [
      '#ffffff',
      '#000000',
      '#ffff00',
      '#0000ff',
      '#ff00ff',
      '#71839e',
      '#f8f8f8',
      '#101010',
    ]) {
      expect(contrastRatio(accent, accentForeground(accent))).toBeGreaterThanOrEqual(4.5);
      for (const background of ['#f1f3f7', '#242d3c'])
        expect(contrastRatio(accentFocus(accent, background), background)).toBeGreaterThanOrEqual(
          3,
        );
    }
  });
});
