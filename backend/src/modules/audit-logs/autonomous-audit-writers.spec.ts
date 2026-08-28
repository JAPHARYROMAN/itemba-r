import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [absolute]
      : [];
  });
}

describe('autonomous audit writer boundary', () => {
  it('forbids raw auditLog.create calls outside the central transaction-aware writer', () => {
    const modulesRoot = path.resolve(__dirname, '..');
    const offenders = readdirSync(modulesRoot, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          (entry.name === 'msaidizi' || entry.name.startsWith('msaidizi-')) &&
          entry.name !== 'audit-logs',
      )
      .flatMap((entry) => sourceFiles(path.join(modulesRoot, entry.name)))
      .filter((file) => /\bauditLog\.create(?:Many)?\s*\(/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(modulesRoot, file).replaceAll('\\', '/'));

    expect(offenders).toEqual([]);
  });
});
