/**
 * Source rules for the content split (architecture §2):
 *   - contact literals (phone numbers, email, P.O. Box) live only in src/content/contact.ts;
 *   - content modules carry no presentation (Tailwind classes, JSX, colours);
 *   - the large content modules are server-only, the small client-safe ones are not;
 *   - client components import only client-safe content modules.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');
const sourceFiles = walk(SRC).filter((f) => /\.(ts|tsx|js|jsx|mjs|css|json)$/.test(f));
const contentFiles = walk(path.join(SRC, 'content')).filter((f) => /\.tsx?$/.test(f));

/** Modules a client component may import: small, no server-only, no presentation. */
const CLIENT_SAFE = new Set(['contact', 'enquiry', 'site', 'flags', 'types', 'corridor', 'nav', 'og', 'errors', 'facts']);

describe('contact literals live only in src/content/contact.ts', () => {
  const FORBIDDEN = [
    { label: '+255 country code', re: /\+255/ },
    { label: 'primary number', re: /255\s?758\s?793\s?511|0758\s?793\s?511/ },
    { label: 'secondary number', re: /255\s?745\s?215\s?047|0745\s?215\s?047/ },
    { label: 'group email', re: /info@itembagrouptz\.com/i },
    { label: 'P.O. Box', re: /P\.\s?O\.\s?Box/i },
  ];

  it.each(FORBIDDEN)('$label', ({ re }) => {
    const offenders = sourceFiles
      .filter((file) => rel(file) !== 'src/content/contact.ts')
      .filter((file) => re.test(readFileSync(file, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('content modules carry no presentation', () => {
  const PRESENTATION = [
    { label: 'className / class attribute', re: /\bclassName\b|\bclass=/ },
    { label: 'JSX', re: /<\/[A-Za-z]|\/>|\(\s*<[A-Za-z]|return\s+<[A-Za-z]/ },
    { label: 'Tailwind utility', re: /['"`\s](?:(?:hover|focus|group-hover|sm|md|lg|xl|print):)?(?:bg|text|border|ring|from|via|to|fill|stroke|shadow)-(?:white|black|slate|gray|zinc|ink|gold|amber|blue|emerald|red|green|transparent)(?:-\d{2,3})?\b/ },
    { label: 'spacing / layout utility', re: /['"`\s](?:p[xytblr]?|m[xytblr]?|gap|h|w|min-h|max-w|grid-cols)-\d/ },
    { label: 'colour literal', re: /#[0-9a-fA-F]{3,8}\b|rgba?\(/ },
  ];
  const files = contentFiles.filter((f) => !f.endsWith('media.generated.ts'));

  it('has content modules to check, and none is a .tsx file', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.filter((f) => f.endsWith('.tsx')).map(rel)).toEqual([]);
  });

  it.each(PRESENTATION)('$label', ({ re }) => {
    const offenders = files
      .filter((file) => {
        // Comments may mention the words; check code only.
        const code = readFileSync(file, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        return re.test(code);
      })
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('server-only boundaries', () => {
  const importsServerOnly = (file: string) => /^import 'server-only';$/m.test(readFileSync(file, 'utf8'));

  it('large content modules import server-only', () => {
    const missing = contentFiles
      .filter((file) => !CLIENT_SAFE.has(path.basename(file).replace(/\.tsx?$/, '')))
      .filter((file) => path.basename(file) !== 'index.ts')
      .filter((file) => !importsServerOnly(file))
      .map(rel);
    expect(missing).toEqual([]);
  });

  it('client-safe modules do not import server-only', () => {
    const wrong = contentFiles
      .filter((file) => path.dirname(file) === path.join(SRC, 'content'))
      .filter((file) => CLIENT_SAFE.has(path.basename(file).replace(/\.tsx?$/, '')))
      .filter(importsServerOnly)
      .map(rel);
    expect(wrong).toEqual([]);
  });

  it("client components import only client-safe content (type-only imports excepted) and never the @/lib/site barrel", () => {
    const clientFiles = sourceFiles.filter((file) => /\.tsx?$/.test(file) && /^\s*['"]use client['"]/.test(readFileSync(file, 'utf8')));
    expect(clientFiles.length).toBeGreaterThan(0);
    const problems: string[] = [];
    for (const file of clientFiles) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/^import\s+(type\s+)?[^;]*?from\s+['"](@\/content\/[^'"]+|@\/lib\/site)['"];?$/gm)) {
        if (match[1]) continue; // `import type` is erased
        const target = match[2] ?? '';
        if (target === '@/lib/site') {
          problems.push(`${rel(file)} imports the server barrel @/lib/site`);
          continue;
        }
        const contentModule = target.replace('@/content/', '').split('/')[0] ?? '';
        if (!CLIENT_SAFE.has(contentModule)) problems.push(`${rel(file)} imports ${target}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
