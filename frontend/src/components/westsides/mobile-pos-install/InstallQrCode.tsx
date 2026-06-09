'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  WESTSIDES_MOBILE_POS_INSTALL_PATH,
  WESTSIDES_MOBILE_POS_NAME,
  getMobilePosInstallUrl,
} from './routes';

interface InstallQrCodeProps {
  className?: string;
  label?: string;
  path?: string;
  size?: number;
}

const QR_VERSION = 5;
const QR_SIZE = QR_VERSION * 4 + 17;
const DATA_CODEWORDS = 108;
const ERROR_CODEWORDS = 26;
const ALIGNMENT_CENTERS = [6, 30];
const LOW_ERROR_CORRECTION_FORMAT_BITS = 1;
const MASK_PATTERN = 0;
const QUIET_ZONE = 4;

export function InstallQrCode({
  className = '',
  label = `${WESTSIDES_MOBILE_POS_NAME} install QR code`,
  path = WESTSIDES_MOBILE_POS_INSTALL_PATH,
  size = 112,
}: InstallQrCodeProps) {
  const [installUrl, setInstallUrl] = useState(() => getMobilePosInstallUrl());

  useEffect(() => {
    setInstallUrl(new URL(path, window.location.origin).toString());
  }, [path]);

  const qrPath = useMemo(() => {
    try {
      return buildQrSvgPath(installUrl);
    } catch {
      return null;
    }
  }, [installUrl]);

  if (!qrPath) {
    return (
      <a
        href={path}
        className={`inline-flex min-h-20 items-center justify-center rounded-lg border border-emerald-200 bg-white px-3 text-center text-xs font-semibold text-emerald-700 ${className}`}
      >
        Open install link
      </a>
    );
  }

  const viewBoxSize = QR_SIZE + QUIET_ZONE * 2;

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      width={size}
      height={size}
      className={`rounded-lg bg-white p-1 text-slate-950 shadow-sm ring-1 ring-slate-200 ${className}`}
      shapeRendering="crispEdges"
    >
      <path fill="currentColor" d={qrPath} />
    </svg>
  );
}

function buildQrSvgPath(data: string) {
  const matrix = createQrMatrix(data);
  const commands: string[] = [];

  matrix.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) commands.push(`M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`);
    });
  });

  return commands.join('');
}

function createQrMatrix(data: string) {
  const dataCodewords = encodeDataCodewords(data);
  const errorCodewords = reedSolomonComputeRemainder(dataCodewords, ERROR_CODEWORDS);
  const codewords = [...dataCodewords, ...errorCodewords];
  const modules = makeMatrix(false);
  const isFunction = makeMatrix(false);

  const setFunctionModule = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= QR_SIZE || y >= QR_SIZE) return;
    modules[y][x] = dark;
    isFunction[y][x] = true;
  };

  drawFinderPattern(0, 0, setFunctionModule);
  drawFinderPattern(QR_SIZE - 7, 0, setFunctionModule);
  drawFinderPattern(0, QR_SIZE - 7, setFunctionModule);
  drawAlignmentPatterns(setFunctionModule);
  drawTimingPatterns(isFunction, setFunctionModule);
  drawFormatBits(setFunctionModule);
  setFunctionModule(8, QR_SIZE - 8, true);
  drawCodewords(codewords, modules, isFunction);

  return modules;
}

function makeMatrix(value: boolean) {
  return Array.from({ length: QR_SIZE }, () => Array<boolean>(QR_SIZE).fill(value));
}

function drawFinderPattern(
  left: number,
  top: number,
  setFunctionModule: (x: number, y: number, dark: boolean) => void,
) {
  for (let y = -1; y <= 7; y += 1) {
    for (let x = -1; x <= 7; x += 1) {
      const xx = left + x;
      const yy = top + y;
      const inFinder = x >= 0 && x <= 6 && y >= 0 && y <= 6;
      const dark =
        inFinder &&
        (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
      setFunctionModule(xx, yy, dark);
    }
  }
}

function drawAlignmentPatterns(setFunctionModule: (x: number, y: number, dark: boolean) => void) {
  for (const x of ALIGNMENT_CENTERS) {
    for (const y of ALIGNMENT_CENTERS) {
      const overlapsFinder =
        (x === 6 && y === 6) || (x === 6 && y === QR_SIZE - 7) || (x === QR_SIZE - 7 && y === 6);
      if (overlapsFinder) continue;

      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }
}

function drawTimingPatterns(
  isFunction: boolean[][],
  setFunctionModule: (x: number, y: number, dark: boolean) => void,
) {
  for (let i = 0; i < QR_SIZE; i += 1) {
    const dark = i % 2 === 0;
    if (!isFunction[6][i]) setFunctionModule(i, 6, dark);
    if (!isFunction[i][6]) setFunctionModule(6, i, dark);
  }
}

function drawFormatBits(setFunctionModule: (x: number, y: number, dark: boolean) => void) {
  const data = (LOW_ERROR_CORRECTION_FORMAT_BITS << 3) | MASK_PATTERN;
  let remainder = data;

  for (let i = 0; i < 10; i += 1) {
    remainder = (remainder << 1) ^ (((remainder >>> 9) & 1) * 0x537);
  }

  const bits = ((data << 10) | remainder) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) !== 0;

  for (let i = 0; i <= 5; i += 1) setFunctionModule(8, i, bit(i));
  setFunctionModule(8, 7, bit(6));
  setFunctionModule(8, 8, bit(7));
  setFunctionModule(7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) setFunctionModule(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i += 1) setFunctionModule(QR_SIZE - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) setFunctionModule(8, QR_SIZE - 15 + i, bit(i));
}

function drawCodewords(codewords: number[], modules: boolean[][], isFunction: boolean[][]) {
  let bitIndex = 0;
  let upward = true;

  for (let right = QR_SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;

    for (let vertical = 0; vertical < QR_SIZE; vertical += 1) {
      const y = upward ? QR_SIZE - 1 - vertical : vertical;

      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        if (isFunction[y][x]) continue;

        const codeword = codewords[Math.floor(bitIndex / 8)] ?? 0;
        const dark = ((codeword >>> (7 - (bitIndex % 8))) & 1) !== 0;
        const masked = (x + y) % 2 === 0 ? !dark : dark;
        modules[y][x] = masked;
        bitIndex += 1;
      }
    }

    upward = !upward;
  }
}

function encodeDataCodewords(data: string) {
  const bytes = Array.from(new TextEncoder().encode(data));
  const maxBytes = 106;

  if (bytes.length > maxBytes) {
    throw new Error(`QR payload is too long for this install code: ${bytes.length} bytes`);
  }

  const bits: number[] = [];
  appendBits(bits, 0x4, 4);
  appendBits(bits, bytes.length, 8);
  bytes.forEach((byte) => appendBits(bits, byte, 8));
  appendBits(bits, 0, Math.min(4, DATA_CODEWORDS * 8 - bits.length));

  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((value, current) => (value << 1) | current, 0));
  }

  for (let pad = 0xec; codewords.length < DATA_CODEWORDS; pad ^= 0xec ^ 0x11) {
    codewords.push(pad);
  }

  return codewords;
}

function appendBits(output: number[], value: number, length: number) {
  for (let i = length - 1; i >= 0; i -= 1) {
    output.push((value >>> i) & 1);
  }
}

function reedSolomonComputeRemainder(data: number[], degree: number) {
  const divisor = reedSolomonComputeDivisor(degree);
  const result = Array<number>(degree).fill(0);

  data.forEach((byte) => {
    const factor = byte ^ result.shift()!;
    result.push(0);
    divisor.forEach((coefficient, index) => {
      result[index] ^= reedSolomonMultiply(coefficient, factor);
    });
  });

  return result;
}

function reedSolomonComputeDivisor(degree: number) {
  const result = Array<number>(degree).fill(0);
  result[degree - 1] = 1;

  for (let root = 1, i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = reedSolomonMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = reedSolomonMultiply(root, 0x02);
  }

  return result;
}

function reedSolomonMultiply(x: number, y: number) {
  let z = 0;

  for (let i = 7; i >= 0; i -= 1) {
    z = ((z << 1) ^ (((z >>> 7) & 1) * 0x11d)) & 0xff;
    z ^= (((y >>> i) & 1) * x) & 0xff;
  }

  return z;
}
