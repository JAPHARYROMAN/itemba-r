import { TextDecoder } from 'node:util';

export const MAX_ADAPTIVE_HOST_FILE_BYTES = 512 * 1024;

export type AdaptiveHostFileMimeType =
  | 'application/json'
  | 'application/pdf'
  | 'text/csv'
  | 'text/markdown'
  | 'text/plain';

export type AdaptiveHostFileExtension =
  | '.csv'
  | '.json'
  | '.log'
  | '.markdown'
  | '.md'
  | '.pdf'
  | '.txt';

export type HostFileRefusalReason =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE_CONTENT'
  | 'UNSUPPORTED_FILE_TYPE';

const MIME_BY_EXTENSION = new Map<AdaptiveHostFileExtension, AdaptiveHostFileMimeType>([
  ['.csv', 'text/csv'],
  ['.json', 'application/json'],
  ['.log', 'text/plain'],
  ['.markdown', 'text/markdown'],
  ['.md', 'text/markdown'],
  ['.pdf', 'application/pdf'],
  ['.txt', 'text/plain'],
]);

/** Content policy shared by broker settlement and encrypted artifact storage. */
export function classifyAdaptiveHostFile(
  extension: string,
  content: Buffer,
): {
  extension: AdaptiveHostFileExtension | null;
  mimeType: AdaptiveHostFileMimeType | null;
  refusalReason: HostFileRefusalReason | null;
} {
  const normalizedExtension = extension.toLowerCase() as AdaptiveHostFileExtension;
  const mimeType = MIME_BY_EXTENSION.get(normalizedExtension) ?? null;
  if (content.length === 0) {
    return { extension: null, mimeType: null, refusalReason: 'EMPTY_FILE' };
  }
  if (content.length > MAX_ADAPTIVE_HOST_FILE_BYTES) {
    return { extension: null, mimeType: null, refusalReason: 'FILE_TOO_LARGE' };
  }
  if (!mimeType) {
    return { extension: null, mimeType: null, refusalReason: 'UNSUPPORTED_FILE_TYPE' };
  }
  if (!contentMatchesMimeType(content, mimeType)) {
    return { extension: null, mimeType: null, refusalReason: 'UNSUPPORTED_FILE_CONTENT' };
  }
  return { extension: normalizedExtension, mimeType, refusalReason: null };
}

export function contentMatchesAdaptiveHostFileBinding(
  content: Buffer,
  extension: AdaptiveHostFileExtension,
  mimeType: AdaptiveHostFileMimeType,
): boolean {
  const classified = classifyAdaptiveHostFile(extension, content);
  return (
    classified.refusalReason == null &&
    classified.extension === extension &&
    classified.mimeType === mimeType
  );
}

function contentMatchesMimeType(content: Buffer, mimeType: AdaptiveHostFileMimeType): boolean {
  if (mimeType === 'application/pdf') return validPdf(content);
  const text = strictUtf8(content);
  if (text == null) return false;
  if (mimeType !== 'application/json') return true;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function strictUtf8(content: Buffer): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(content);
    return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text) ? null : text;
  } catch {
    return null;
  }
}

function validPdf(content: Buffer): boolean {
  if (content.length < 11 || !content.subarray(0, 5).equals(Buffer.from('%PDF-', 'ascii'))) {
    return false;
  }
  const tail = content.subarray(Math.max(0, content.length - 1_024)).toString('latin1');
  const marker = tail.lastIndexOf('%%EOF');
  return marker >= 0 && /^[\x00\x09\x0a\x0c\x0d\x20]*$/u.test(tail.slice(marker + 5));
}
