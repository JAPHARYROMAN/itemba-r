#!/usr/bin/env node
// Tone-down helper: surgically unregister backend modules from app.module.ts.
// Usage: node scripts/tone-down/remove-modules.mjs <module-dir-name> [...more]
// For each module dir name (e.g. "fuel-tanks"), removes:
//   1. the import line referencing './modules/<name>/...'
//   2. the corresponding `XxxModule,` entry in the imports array
// Prints what was removed; exits non-zero if a name matched nothing.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APP_MODULE = resolve(process.cwd(), 'backend/src/app.module.ts');
const names = process.argv.slice(2);
if (names.length === 0) {
  console.error('Usage: remove-modules.mjs <module-dir-name> [...]');
  process.exit(1);
}

let src = readFileSync(APP_MODULE, 'utf8');
let failed = false;

for (const name of names) {
  const importRe = new RegExp(
    `^import \\{ (\\w+) \\} from '\\./modules/${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^']+';\\r?\\n`,
    'm',
  );
  const match = src.match(importRe);
  if (!match) {
    console.error(`NO IMPORT MATCH: ${name}`);
    failed = true;
    continue;
  }
  const symbol = match[1];
  src = src.replace(importRe, '');
  const regRe = new RegExp(`^[ \\t]*${symbol},[ \\t]*\\r?\\n`, 'm');
  if (!regRe.test(src)) {
    console.error(`NO REGISTRATION MATCH: ${symbol} (${name})`);
    failed = true;
    continue;
  }
  src = src.replace(regRe, '');
  console.log(`removed: ${name} (${symbol})`);
}

writeFileSync(APP_MODULE, src);
if (failed) process.exit(2);
