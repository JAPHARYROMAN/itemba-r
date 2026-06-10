#!/usr/bin/env node
// Tone-down helper: remove top-level sidebar nav sections by label.
// Usage: node scripts/tone-down/remove-nav-sections.mjs "Petroleum" "Agriculture" ...
// Top-level sections in sidebar.tsx open with a line exactly "  {" and close
// with a line exactly "  }," — children are indented deeper, so matching on
// those exact lines is unambiguous.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SIDEBAR = resolve(process.cwd(), 'frontend/src/components/layout/sidebar.tsx');
const labels = process.argv.slice(2);
if (labels.length === 0) {
  console.error('Usage: remove-nav-sections.mjs "<Section Label>" [...]');
  process.exit(1);
}

let lines = readFileSync(SIDEBAR, 'utf8').split('\n');
let failed = false;

for (const label of labels) {
  const labelIdx = lines.findIndex((l) => l.trim() === `label: '${label}',`);
  if (labelIdx === -1) {
    console.error(`NO MATCH: ${label}`);
    failed = true;
    continue;
  }
  let start = labelIdx;
  while (start >= 0 && lines[start].replace(/\r$/, '') !== '  {') start--;
  let end = labelIdx;
  while (end < lines.length && lines[end].replace(/\r$/, '') !== '  },') end++;
  if (start < 0 || end >= lines.length) {
    console.error(`BOUNDARY FAIL: ${label}`);
    failed = true;
    continue;
  }
  lines.splice(start, end - start + 1);
  console.log(`removed nav section: ${label} (${end - start + 1} lines)`);
}

writeFileSync(SIDEBAR, lines.join('\n'));
if (failed) process.exit(2);
