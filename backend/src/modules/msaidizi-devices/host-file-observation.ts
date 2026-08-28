import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  AdaptiveHostFileExtension,
  AdaptiveHostFileMimeType,
  classifyAdaptiveHostFile,
  HostFileRefusalReason,
} from '../msaidizi-artifacts/host-file-content-policy';
import { fixedTimeHexEquals, sha256Hex, stableJson } from './device-security';
import type { ActionResultDto, DataProvenanceDto } from './dto/msaidizi-device.dto';

export { MAX_ADAPTIVE_HOST_FILE_BYTES } from '../msaidizi-artifacts/host-file-content-policy';

export interface HostFileActionContext {
  capability: string;
  argsDigest: string;
  step: { arguments: Prisma.JsonValue };
}

export interface HostFileObservationBinding {
  capability: 'filesystem.file.read';
  mimeType: AdaptiveHostFileMimeType;
  extension: AdaptiveHostFileExtension;
  argumentsSha256: string;
  sourceIdentifierHash: string;
}

export interface DecodedHostFileObservation {
  content: Buffer;
  contentSha256: string;
  byteSize: number;
  argumentsSha256: string;
  sourceIdentifierHash: string;
  binding: HostFileObservationBinding | null;
  refusalReason: HostFileRefusalReason | null;
}

/**
 * Revalidates a file read at the central trust boundary. Raw paths never leave
 * this function: downstream storage and audit receive only their hashes.
 */
export function decodeBoundHostFileRead(
  action: HostFileActionContext,
  value: unknown,
): DecodedHostFileObservation | null {
  if (action.capability !== 'filesystem.file.read') return null;
  const argumentsValue = strictObject(
    action.step.arguments,
    'Host file arguments are not an object',
  );
  if (!hasExactKeys(argumentsValue, ['maxBytes', 'relativePath', 'rootId'])) {
    throw new BadRequestException('Host file arguments do not match the reviewed step');
  }
  const rootId = argumentsValue.rootId;
  const relativePath = argumentsValue.relativePath;
  const maxBytes = argumentsValue.maxBytes;
  if (
    typeof rootId !== 'string' ||
    rootId.length === 0 ||
    rootId.length > 64 ||
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    relativePath.length > 32_767 ||
    !Number.isSafeInteger(maxBytes) ||
    Number(maxBytes) <= 0 ||
    Number(maxBytes) > 67_108_864
  ) {
    throw new BadRequestException('Host file arguments are invalid');
  }
  const canonicalRelativePath = canonicalWindowsRelativePath(relativePath);
  const argumentsSha256 = sha256Hex(stableJson(argumentsValue));
  if (!fixedTimeHexEquals(argumentsSha256, action.argsDigest)) {
    throw new BadRequestException('Host file argument digest does not match the queued action');
  }

  const result = strictObject(value, 'Host file result is not an object');
  if (
    !hasExactKeys(result, ['contentBase64', 'contentSha256', 'length', 'relativePath', 'rootId']) ||
    result.rootId !== rootId ||
    result.relativePath !== canonicalRelativePath ||
    typeof result.contentBase64 !== 'string' ||
    typeof result.contentSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(result.contentSha256) ||
    !Number.isSafeInteger(result.length) ||
    Number(result.length) < 0 ||
    Number(result.length) > Number(maxBytes) ||
    result.contentBase64.length !== Math.ceil(Number(result.length) / 3) * 4
  ) {
    throw new BadRequestException('Host file result does not match its reviewed action');
  }

  const content = decodeCanonicalBase64(result.contentBase64);
  try {
    if (content.length !== result.length) {
      throw new BadRequestException('Host file length does not match its payload');
    }
    const contentSha256 = createHash('sha256').update(content).digest('hex');
    if (!fixedTimeHexEquals(contentSha256, result.contentSha256)) {
      throw new BadRequestException('Host file digest does not match its payload');
    }
    const classified = classifyAdaptiveHostFile(path.win32.extname(canonicalRelativePath), content);
    const normalizedArgumentsSha256 = argumentsSha256.toLowerCase();
    const sourceIdentifierHash = sha256Hex(`${rootId}:${canonicalRelativePath}`).toLowerCase();
    return {
      content,
      contentSha256,
      byteSize: content.length,
      argumentsSha256: normalizedArgumentsSha256,
      sourceIdentifierHash,
      binding:
        classified.refusalReason == null && classified.mimeType && classified.extension
          ? {
              capability: 'filesystem.file.read',
              mimeType: classified.mimeType,
              extension: classified.extension,
              argumentsSha256: normalizedArgumentsSha256,
              sourceIdentifierHash,
            }
          : null,
      refusalReason: classified.refusalReason,
    };
  } catch (error) {
    content.fill(0);
    throw error;
  }
}

/** Exact local-I/O and untrusted provenance receipt required for file bytes. */
export function hostFileReceiptMatches(
  decoded: DecodedHostFileObservation,
  dto: Pick<ActionResultDto, 'localBytesRead' | 'localBytesWritten' | 'provenance'>,
): boolean {
  if (dto.localBytesRead !== decoded.byteSize || dto.localBytesWritten !== 0) return false;
  return (
    matchingFileProvenance(dto.provenance, decoded.contentSha256).filter((item) =>
      fixedTimeHexEquals(item.sourceIdentifierHash, decoded.sourceIdentifierHash),
    ).length === 1
  );
}

function matchingFileProvenance(
  provenance: DataProvenanceDto[],
  contentSha256: string,
): DataProvenanceDto[] {
  return provenance.filter(
    (item) =>
      item.sourceType === 'windows-file-content' &&
      fixedTimeHexEquals(item.contentSha256, contentSha256) &&
      (item.trust === 'UntrustedContent' || item.trust === 3),
  );
}

function canonicalWindowsRelativePath(value: string): string {
  if (
    value.includes('\0') ||
    value.startsWith('\\') ||
    value.startsWith('/') ||
    path.win32.isAbsolute(value)
  ) {
    throw new BadRequestException('Host file path must remain relative');
  }
  const segments = value.replaceAll('/', '\\').split('\\');
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === '.' ||
        segment === '..' ||
        segment.includes(':') ||
        /[<>"|?*]/u.test(segment) ||
        segment.endsWith(' ') ||
        segment.endsWith('.'),
    )
  ) {
    throw new BadRequestException('Host file path is not canonical and safe');
  }
  return segments.join('\\');
}

function strictObject(value: unknown, message: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(message);
  }
  return value as Record<string, unknown>;
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function decodeCanonicalBase64(value: string): Buffer {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) {
    throw new BadRequestException('Host file content is not canonical Base64');
  }
  const content = Buffer.from(value, 'base64');
  if (content.toString('base64') !== value) {
    content.fill(0);
    throw new BadRequestException('Host file content is not canonical Base64');
  }
  return content;
}
