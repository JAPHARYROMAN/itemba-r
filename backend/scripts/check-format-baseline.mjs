#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import prettier from 'prettier';

const ROOT = process.cwd();
const BASELINE_FILE = join(ROOT, 'scripts', 'format-baseline.json');
const TARGET_DIRS = [join(ROOT, 'src'), join(ROOT, 'test')];

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') {
      continue;
    }
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      yield fullPath;
    }
  }
}

function normalize(filePath) {
  return relative(ROOT, filePath).split(sep).join('/');
}

function loadBaseline() {
  if (!existsSync(BASELINE_FILE)) return { files: [] };
  return JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
}

async function collectUnformattedFiles() {
  const files = [];
  for (const root of TARGET_DIRS) {
    try {
      await stat(root);
    } catch {
      continue;
    }

    for await (const file of walk(root)) {
      const contents = await readFile(file, 'utf8');
      const options = (await prettier.resolveConfig(file)) ?? {};
      const ok = await prettier.check(contents, { ...options, filepath: file });
      if (!ok) files.push(normalize(file));
    }
  }
  return files.sort();
}

async function main() {
  const writeMode = process.argv.includes('--write-baseline');
  const unformatted = await collectUnformattedFiles();

  if (writeMode) {
    writeFileSync(
      BASELINE_FILE,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          note:
            'Files with known Prettier drift. The format gate fails only when new files are added to this list. ' +
            'Regenerate after deliberate formatting cleanup with: npm run format:check -- --write-baseline',
          files: unformatted,
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    console.log(`Wrote format baseline with ${unformatted.length} known file(s).`);
    return;
  }

  const known = new Set(loadBaseline().files ?? []);
  const newDrift = unformatted.filter((file) => !known.has(file));

  if (newDrift.length > 0) {
    console.error(
      `format baseline: ${newDrift.length} NEW unformatted file(s) found (${unformatted.length - newDrift.length} known baseline).`,
    );
    for (const file of newDrift) console.error(`  ${file}`);
    process.exit(1);
  }

  console.log(`format baseline: OK (${unformatted.length} known unformatted file(s); 0 new).`);
}

main().catch((err) => {
  console.error('format baseline check crashed:', err);
  process.exit(2);
});
