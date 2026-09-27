#!/usr/bin/env node
/**
 * Checks or records scripts/pdf-inputs.lock, the drift guard between the
 * print inputs (src/content/profile/**, src/print/**, src/styles/print.css)
 * and the four committed profile PDFs.
 *
 *   node scripts/pdf-lock.mjs           check; exits 1 on drift
 *   node scripts/pdf-lock.mjs --write   record the current inputs and PDFs
 *
 * `--write` refuses when the inputs changed since the last lock but a PDF did
 * not: every `npm run pdf` rewrites all four files (Chromium stamps a new
 * creation date), so an unchanged PDF means it was not regenerated.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  LOCK_PATH,
  PDF_OUTPUTS,
  WEBSITE_ROOT,
  computePdfInputs,
  computePdfOutputs,
  diffInputs,
  diffOutputs,
  readPdfLock,
  serializePdfLock,
} from './lib/pdf-inputs.mjs';

const write = process.argv.includes('--write');
const inputs = computePdfInputs();
const outputs = computePdfOutputs();
const lock = readPdfLock();

const missing = PDF_OUTPUTS.filter((file) => !outputs[file]);
if (missing.length) {
  console.error(`Missing PDFs: ${missing.join(', ')}. Run \`npm run pdf\` first.`);
  process.exit(1);
}

const inputDrift = lock ? diffInputs(lock.inputs.files, inputs.files) : null;
const inputsChanged = !lock || lock.inputs.sha256 !== inputs.sha256;
const changedPdfs = lock ? diffOutputs(lock.outputs, outputs) : [...PDF_OUTPUTS];

function describeInputs() {
  if (!inputDrift) return '  (no lock yet)';
  const lines = [
    ...inputDrift.changed.map((f) => `  changed  ${f}`),
    ...inputDrift.added.map((f) => `  added    ${f}`),
    ...inputDrift.removed.map((f) => `  removed  ${f}`),
  ];
  return lines.join('\n') || '  (combined digest differs)';
}

if (write) {
  const stale = PDF_OUTPUTS.filter((file) => !changedPdfs.includes(file));
  if (lock && inputsChanged && stale.length) {
    console.error('The PDF inputs changed since the last lock, but these PDFs were not regenerated:');
    for (const file of stale) console.error(`  ${file}`);
    console.error('Inputs:');
    console.error(describeInputs());
    console.error('Run `npm run pdf`, review the PDFs, then `npm run pdf:lock`.');
    process.exit(1);
  }
  writeFileSync(path.join(WEBSITE_ROOT, LOCK_PATH), serializePdfLock(inputs, outputs), 'utf8');
  console.log(`Wrote ${LOCK_PATH}: ${Object.keys(inputs.files).length} inputs (${inputs.sha256.slice(0, 12)}), ${PDF_OUTPUTS.length} PDFs.`);
  process.exit(0);
}

if (!lock) {
  console.error(`${LOCK_PATH} is missing. Run \`npm run pdf\`, then \`npm run pdf:lock\`.`);
  process.exit(1);
}
let ok = true;
if (inputsChanged) {
  ok = false;
  console.error('The PDF inputs changed since the PDFs were last generated:');
  console.error(describeInputs());
}
if (changedPdfs.length) {
  ok = false;
  console.error('These PDFs differ from the lock:');
  for (const file of changedPdfs) console.error(`  ${file}`);
}
if (!ok) {
  console.error('Run `npm run pdf`, review the PDFs, then `npm run pdf:lock` and commit both.');
  process.exit(1);
}
console.log(`${LOCK_PATH} is current (${Object.keys(inputs.files).length} inputs, ${PDF_OUTPUTS.length} PDFs).`);
