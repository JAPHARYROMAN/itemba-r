/**
 * The PDF drift guard (architecture §5.6). The four downloadable profiles in
 * public/downloads/ are generated from the print documents on /company-profile,
 * so any change to what they are rendered from must be followed by
 * `npm run pdf` (regenerate) and `npm run pdf:lock` (record).
 * scripts/pdf-inputs.lock stores a SHA-256 per input file, a combined digest,
 * and the SHA-256 of each committed PDF; tests/unit/pdf-inputs-lock.test.ts
 * fails when either side drifts.
 *
 * The inputs are the fixed roots below (the profile content, the print
 * components, the print stylesheet and the typeface the PDFs are set in)
 * plus the transitive import closure of the print entry points: every
 * module under src/ that ProfileDocuments or the profile content imports,
 * directly or not. That covers src/content/companies.ts (legal names, TINs,
 * incorporation, directors), contact.ts, site.ts, media.ts and
 * media.generated.ts, flags.ts and types.ts, so editing any of them fails
 * the guard until the PDFs are regenerated.
 *
 * Text inputs are hashed with CRLF folded to LF, so a Windows checkout with
 * converted line endings does not trip the guard; binary inputs (the font)
 * and the PDFs are hashed raw.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEBSITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LOCK_PATH = 'scripts/pdf-inputs.lock';

/**
 * What the print documents are generated from: directories are walked
 * recursively, files are taken as they are. Paths relative to website/.
 */
export const PDF_INPUT_ROOTS = [
  'src/content/profile',
  'src/print',
  'src/styles/print.css',
  'src/design/fonts.ts',
  'src/assets/fonts/InterVariable-latin.woff2',
];

/** The print entry points whose transitive imports (under src/) are inputs too. */
export const PDF_ENTRY_POINTS = ['src/print/ProfileDocuments.tsx', 'src/content/profile/index.ts'];

/** Inputs hashed as raw bytes rather than as text. */
const BINARY_INPUT = /\.(?:woff2?|ttf|otf|png|jpe?g|webp|avif)$/i;

/** The committed outputs, in generation order (scripts/generate-profile-pdfs.mjs). */
export const PDF_OUTPUTS = [
  'public/downloads/itemba-group-profile.pdf',
  'public/downloads/itemba-westsides-profile.pdf',
  'public/downloads/itemba-mwanjalisi-profile.pdf',
  'public/downloads/itemba-enterprises-profile.pdf',
];

/** @param {string | Uint8Array} data */
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** @param {string} rel */
const toPosix = (rel) => rel.split(path.sep).join('/');

/** Module specifiers of import, export-from, side-effect import and dynamic import statements. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"\n]+)\1/g;
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.mts', '.mjs', '.js', '.jsx', '.css', '/index.ts', '/index.tsx', '/index.js'];

/**
 * The file a specifier names, relative to website/, or null for a package
 * (react, next/…, server-only) or anything outside src/.
 * @param {string} root
 * @param {string} fromRel  the importing file, relative to website/
 * @param {string} specifier
 * @returns {string | null}
 */
export function resolveImport(root, fromRel, specifier) {
  let base;
  if (specifier.startsWith('@/')) base = path.join(root, 'src', specifier.slice(2));
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(path.join(root, fromRel)), specifier);
  else return null;
  for (const suffix of RESOLVE_SUFFIXES) {
    const full = base + suffix;
    if (existsSync(full) && statSync(full).isFile()) {
      const rel = toPosix(path.relative(root, full));
      return rel.startsWith('src/') ? rel : null;
    }
  }
  return null;
}

/**
 * Every module under src/ reachable from the entry points through static
 * or dynamic imports, the entry points included. Type-only imports count
 * too: they are cheap to hash, and a type change can change what renders.
 * @param {string} [root]
 * @param {readonly string[]} [entries]
 * @returns {string[]}
 */
export function importClosure(root = WEBSITE_ROOT, entries = PDF_ENTRY_POINTS) {
  /** @type {Set<string>} */
  const seen = new Set();
  const queue = entries.filter((rel) => existsSync(path.join(root, rel)));
  while (queue.length) {
    const rel = /** @type {string} */ (queue.shift());
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (!/\.m?[jt]sx?$/.test(rel)) continue;
    const code = readFileSync(path.join(root, rel), 'utf8');
    for (const match of code.matchAll(SPECIFIER)) {
      const target = resolveImport(root, rel, match[2] ?? '');
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return [...seen].sort();
}

/**
 * Every input file, relative to website/ with forward slashes, sorted: the
 * fixed roots plus the entry points' import closure.
 * @param {string} [root]
 * @returns {string[]}
 */
export function listPdfInputs(root = WEBSITE_ROOT) {
  /** @type {Set<string>} */
  const out = new Set();
  /** @param {string} full */
  const walk = (full) => {
    if (!existsSync(full)) return;
    if (statSync(full).isDirectory()) {
      for (const entry of readdirSync(full)) walk(path.join(full, entry));
    } else {
      out.add(toPosix(path.relative(root, full)));
    }
  };
  for (const rel of PDF_INPUT_ROOTS) walk(path.join(root, rel));
  for (const rel of importClosure(root)) out.add(rel);
  return [...out].sort();
}

/**
 * SHA-256 of a text input with CRLF folded to LF.
 * @param {Buffer} bytes
 */
export function hashTextInput(bytes) {
  return sha256(bytes.toString('utf8').replace(/\r\n/g, '\n'));
}

/**
 * SHA-256 of an input: its raw bytes for a binary file (the font), its
 * CRLF-folded text otherwise.
 * @param {string} rel
 * @param {Buffer} bytes
 */
export function hashInput(rel, bytes) {
  return BINARY_INPUT.test(rel) ? sha256(bytes) : hashTextInput(bytes);
}

/**
 * Combined digest over the per-file digests: one `<sha>  <path>` line per
 * file, sorted by path (the shape `sha256sum` prints).
 * @param {Record<string, string>} files
 */
export function combinedDigest(files) {
  const lines = Object.keys(files)
    .sort()
    .map((file) => `${files[file]}  ${file}\n`)
    .join('');
  return sha256(lines);
}

/**
 * @typedef {{ sha256: string, files: Record<string, string> }} InputState
 * @typedef {Record<string, { sha256: string, bytes: number }>} OutputState
 * @typedef {{ algorithm: 'sha256', inputs: { roots: string[], entryPoints: string[] } & InputState, outputs: OutputState }} PdfLock
 */

/**
 * @param {string} [root]
 * @returns {InputState}
 */
export function computePdfInputs(root = WEBSITE_ROOT) {
  /** @type {Record<string, string>} */
  const files = {};
  for (const file of listPdfInputs(root)) files[file] = hashInput(file, readFileSync(path.join(root, file)));
  return { sha256: combinedDigest(files), files };
}

/**
 * @param {string} [root]
 * @returns {OutputState}
 */
export function computePdfOutputs(root = WEBSITE_ROOT) {
  /** @type {OutputState} */
  const outputs = {};
  for (const file of PDF_OUTPUTS) {
    const full = path.join(root, file);
    if (!existsSync(full)) continue;
    const bytes = readFileSync(full);
    outputs[file] = { sha256: sha256(bytes), bytes: bytes.length };
  }
  return outputs;
}

/**
 * @param {string} [root]
 * @returns {PdfLock | null}
 */
export function readPdfLock(root = WEBSITE_ROOT) {
  const full = path.join(root, LOCK_PATH);
  if (!existsSync(full)) return null;
  return /** @type {PdfLock} */ (JSON.parse(readFileSync(full, 'utf8')));
}

/**
 * Input files added, removed or changed since the lock was written.
 * @param {Record<string, string>} locked
 * @param {Record<string, string>} current
 * @returns {{ added: string[], removed: string[], changed: string[] }}
 */
export function diffInputs(locked, current) {
  const added = Object.keys(current).filter((f) => !(f in locked));
  const removed = Object.keys(locked).filter((f) => !(f in current));
  const changed = Object.keys(current).filter((f) => f in locked && locked[f] !== current[f]);
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}

/**
 * PDFs whose bytes differ from the lock (or are missing on either side).
 * @param {OutputState} locked
 * @param {OutputState} current
 * @returns {string[]}
 */
export function diffOutputs(locked, current) {
  return PDF_OUTPUTS.filter((file) => locked[file]?.sha256 !== current[file]?.sha256);
}

/**
 * The lock file's contents for the current state.
 * @param {InputState} inputs
 * @param {OutputState} outputs
 */
export function serializePdfLock(inputs, outputs) {
  const lock = {
    $comment:
      'PDF drift guard (architecture §5.6). The profile PDFs in public/downloads/ are generated from these inputs: the roots, plus every module under src/ that the entry points import, directly or not. After changing any of them run `npm run pdf` (build and regenerate), then `npm run pdf:lock` to record the new inputs and PDFs. Checked by tests/unit/pdf-inputs-lock.test.ts. Text inputs are hashed with CRLF folded to LF, binary ones (the font) raw; `inputs.sha256` is the SHA-256 of the `<sha>  <path>` lines, sorted by path.',
    algorithm: 'sha256',
    inputs: { roots: PDF_INPUT_ROOTS, entryPoints: PDF_ENTRY_POINTS, sha256: inputs.sha256, files: inputs.files },
    outputs,
  };
  return `${JSON.stringify(lock, null, 2)}\n`;
}
