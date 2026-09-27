/**
 * The PDF drift guard (architecture §5.6). The four downloadable profiles in
 * public/downloads/ are generated from the print documents on /company-profile,
 * so any change to the profile content, the print components or the print
 * stylesheet must be followed by `npm run pdf` (regenerate) and
 * `npm run pdf:lock` (record). scripts/pdf-inputs.lock stores a SHA-256 per
 * input file, a combined digest, and the SHA-256 of each committed PDF;
 * tests/unit/pdf-inputs-lock.test.ts fails when either side drifts.
 *
 * Text inputs are hashed with CRLF folded to LF, so a Windows checkout with
 * converted line endings does not trip the guard; the PDFs are hashed raw.
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
export const PDF_INPUT_ROOTS = ['src/content/profile', 'src/print', 'src/styles/print.css'];

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

/**
 * Every input file, relative to website/ with forward slashes, sorted.
 * @param {string} [root]
 * @returns {string[]}
 */
export function listPdfInputs(root = WEBSITE_ROOT) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} full */
  const walk = (full) => {
    if (!existsSync(full)) return;
    if (statSync(full).isDirectory()) {
      for (const entry of readdirSync(full)) walk(path.join(full, entry));
    } else {
      out.push(toPosix(path.relative(root, full)));
    }
  };
  for (const rel of PDF_INPUT_ROOTS) walk(path.join(root, rel));
  return out.sort();
}

/**
 * SHA-256 of a text input with CRLF folded to LF.
 * @param {Buffer} bytes
 */
export function hashTextInput(bytes) {
  return sha256(bytes.toString('utf8').replace(/\r\n/g, '\n'));
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
 * @typedef {{ algorithm: 'sha256', inputs: { roots: string[] } & InputState, outputs: OutputState }} PdfLock
 */

/**
 * @param {string} [root]
 * @returns {InputState}
 */
export function computePdfInputs(root = WEBSITE_ROOT) {
  /** @type {Record<string, string>} */
  const files = {};
  for (const file of listPdfInputs(root)) files[file] = hashTextInput(readFileSync(path.join(root, file)));
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
      'PDF drift guard (architecture §5.6). The profile PDFs in public/downloads/ are generated from these inputs. After changing any of them run `npm run pdf` (build and regenerate), then `npm run pdf:lock` to record the new inputs and PDFs. Checked by tests/unit/pdf-inputs-lock.test.ts. Text inputs are hashed with CRLF folded to LF; `inputs.sha256` is the SHA-256 of the `<sha>  <path>` lines, sorted by path.',
    algorithm: 'sha256',
    inputs: { roots: PDF_INPUT_ROOTS, sha256: inputs.sha256, files: inputs.files },
    outputs,
  };
  return `${JSON.stringify(lock, null, 2)}\n`;
}
