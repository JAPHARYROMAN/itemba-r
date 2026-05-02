import { existsSync, promises as fs } from 'fs';
import path from 'path';
import prettier from 'prettier';

const root = process.cwd();
const baselinePath = path.join(root, 'scripts', 'format-baseline.json');
const scanRoots = ['src'];
const rootFiles = [
  '.eslintrc.json',
  '.prettierrc',
  'next.config.js',
  'package.json',
  'postcss.config.js',
  'tailwind.config.ts',
  'tsconfig.json',
  'vitest.config.ts',
];
const extensions = new Set(['.css', '.js', '.jsx', '.json', '.ts', '.tsx']);
const ignoredDirs = new Set(['.next', 'coverage', 'dist', 'node_modules']);

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name) && !entry.name.startsWith('node_modules.corrupt-')) {
        files.push(...(await walk(fullPath)));
      }
      continue;
    }
    if (entry.isFile() && extensions.has(path.extname(entry.name))) files.push(fullPath);
  }

  return files;
}

async function collectFiles() {
  const fromRoots = (
    await Promise.all(
      scanRoots
        .map((scanRoot) => path.join(root, scanRoot))
        .filter((scanRoot) => existsSync(scanRoot))
        .map(walk),
    )
  ).flat();

  const fromRootFiles = rootFiles
    .map((file) => path.join(root, file))
    .filter((file) => existsSync(file));

  return [...fromRoots, ...fromRootFiles].sort();
}

async function isFormatted(file) {
  const source = await fs.readFile(file, 'utf8');
  const options = await prettier.resolveConfig(file);
  return prettier.check(source, { ...options, filepath: file });
}

async function main() {
  const writeMode = process.argv.includes('--write-baseline');
  const files = await collectFiles();
  const unformatted = [];

  for (const file of files) {
    if (!(await isFormatted(file))) {
      unformatted.push(path.relative(root, file).replaceAll(path.sep, '/'));
    }
  }

  if (writeMode) {
    await fs.mkdir(path.dirname(baselinePath), { recursive: true });
    await fs.writeFile(
      baselinePath,
      `${JSON.stringify({ knownUnformatted: unformatted }, null, 2)}\n`,
    );
    console.log(`Wrote format baseline with ${unformatted.length} known file(s).`);
    return;
  }

  const baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8'));
  const known = new Set(baseline.knownUnformatted ?? []);
  const newDrift = unformatted.filter((file) => !known.has(file));

  if (newDrift.length > 0) {
    console.error(
      `format baseline: ${newDrift.length} NEW unformatted file(s) found (${unformatted.length - newDrift.length} known baseline).`,
    );
    console.error(newDrift.map((file) => `  - ${file}`).join('\n'));
    process.exitCode = 1;
    return;
  }

  console.log(`format baseline: OK (${unformatted.length} known unformatted file(s); 0 new).`);
}

main().catch((err) => {
  console.error('format baseline check crashed:', err);
  process.exit(1);
});
