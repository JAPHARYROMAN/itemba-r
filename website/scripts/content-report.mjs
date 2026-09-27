#!/usr/bin/env node
/**
 * Content fact report for the owner: the flags in effect
 * (src/content/flags.ts) and every claim in src/content/facts.ts that is
 * still unconfirmed, with where it appears publicly and whether the rebuilt
 * pages show it under the current flags.
 *
 * Usage: npm run content:report [-- --json]
 *
 * flags.ts and facts.ts are dependency-free by design (type imports only),
 * so this script transpiles and evaluates just those two files with the
 * TypeScript compiler already in devDependencies.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');

function loadTsModule(file) {
  const source = readFileSync(path.join(ROOT, file), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  });
  const cjs = { exports: {} };
  const localRequire = (id) => {
    throw new Error(`${file} imports ${id}; keep flags.ts and facts.ts dependency-free (type imports only).`);
  };
  vm.runInNewContext(outputText, { module: cjs, exports: cjs.exports, require: localRequire }, { filename: file });
  return cjs.exports;
}

const { flags } = loadTsModule('src/content/flags.ts');
const { facts } = loadTsModule('src/content/facts.ts');

const rows = Object.entries(facts).map(([key, fact]) => {
  const flagValue = fact.flag ? flags[fact.flag] : undefined;
  const shownWhenRebuilt =
    fact.flag === undefined ? 'yes (no flag)' : typeof flagValue === 'boolean' ? (flagValue ? 'yes' : 'no') : String(flagValue);
  return {
    key,
    status: fact.status,
    value: fact.value,
    flag: fact.flag ?? null,
    flagValue: flagValue ?? null,
    shownWhenRebuilt,
    publicUse: fact.publicUse,
    note: fact.note,
  };
});
const unconfirmed = rows.filter((r) => r.status === 'unconfirmed');

if (process.argv.includes('--json')) {
  console.log(
    JSON.stringify({ flags, unconfirmed, confirmed: rows.filter((r) => r.status === 'confirmed').map((r) => r.key) }, null, 2),
  );
  process.exit(0);
}

console.log('Content flags in effect (src/content/flags.ts)');
for (const [name, value] of Object.entries(flags)) console.log(`  ${name.padEnd(32)} ${JSON.stringify(value)}`);
console.log('');
console.log(`Unconfirmed facts: ${unconfirmed.length} of ${rows.length} (src/content/facts.ts)`);
console.log('"shown" is what the site shows under the flags above; "appears in" lists where the claim is stated when shown.');
for (const r of unconfirmed) {
  console.log('');
  console.log(`- ${r.key}: ${typeof r.value === 'string' ? r.value : JSON.stringify(r.value)}`);
  if (r.flag) console.log(`    flag: ${r.flag} = ${JSON.stringify(r.flagValue)}  (shown: ${r.shownWhenRebuilt})`);
  console.log(`    appears in: ${r.publicUse.length ? r.publicUse.join('; ') : 'not stated anywhere'}`);
  console.log(`    why: ${r.note}`);
}
