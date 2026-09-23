import { BadRequestException } from '@nestjs/common';
import { unzipSync } from 'fflate';
import * as mammoth from 'mammoth';
import * as ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export type DocumentPreview =
  | { kind: 'text'; text: string; truncated: boolean; note?: string }
  | {
      kind: 'table';
      sheets: Array<{ name: string; rows: string[][] }>;
      truncated: boolean;
      note: string;
    }
  | { kind: 'pdf' | 'image' | 'download'; note?: string };

function textPreview(value: string, note?: string): DocumentPreview {
  return { kind: 'text', text: value.slice(0, 100000), truncated: value.length > 100000, note };
}

/** Inspect expanded sizes before either Office parser sees the archive. No files are extracted to disk. */
export function validateOfficeArchive(buffer: Buffer, requiredEntry: string) {
  let total = 0;
  let count = 0;
  let found = false;
  unzipSync(buffer, {
    filter(entry) {
      count++;
      total += entry.originalSize;
      if (count > 2048 || total > 32 * 1024 * 1024 || entry.originalSize > 16 * 1024 * 1024)
        throw new BadRequestException(
          'Office file is too large to preview. Download the original instead.',
        );
      if (entry.name === requiredEntry) found = true;
      return false;
    },
  });
  if (!found) throw new BadRequestException('The file content does not match its document format.');
}

export async function previewDocument(buffer: Buffer, mimeType: string): Promise<DocumentPreview> {
  const mime = mimeType.split(';')[0].toLowerCase();
  if (mime === 'application/pdf')
    return buffer.subarray(0, 5).toString() === '%PDF-'
      ? { kind: 'pdf' }
      : { kind: 'download', note: 'This file does not contain a recognised PDF header.' };
  if (
    mime === 'image/png' &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { kind: 'image' };
  if (mime === 'image/jpeg' && buffer[0] === 255 && buffer[1] === 216) return { kind: 'image' };
  if (
    mime === 'image/webp' &&
    buffer.subarray(0, 4).toString() === 'RIFF' &&
    buffer.subarray(8, 12).toString() === 'WEBP'
  )
    return { kind: 'image' };
  if (buffer.length > 10 * 1024 * 1024)
    return { kind: 'download', note: 'Files over 10 MB are available as downloads.' };
  try {
    if (mime === DOCX) {
      validateOfficeArchive(buffer, 'word/document.xml');
      return textPreview(
        (await mammoth.extractRawText({ buffer })).value,
        'Text preview. Download the Word file to see its full layout, images and comments.',
      );
    }
    if (mime === XLSX) {
      validateOfficeArchive(buffer, 'xl/workbook.xml');
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(buffer as unknown as ExcelJS.Buffer);
      const sheets = book.worksheets
        .filter((sheet) => sheet.state === 'visible')
        .slice(0, 10)
        .map((sheet) => {
          const rows: string[][] = [];
          for (let row = 1; row <= Math.min(sheet.rowCount, 200); row++) {
            rows.push(
              Array.from({ length: Math.min(sheet.columnCount, 40) }, (_, col) => {
                const cell = sheet.getRow(row).getCell(col + 1);
                if (cell.isMerged && cell.master.address !== cell.address) return '';
                if (typeof cell.value === 'number' && /^0\.0{1,10}$/.test(cell.numFmt)) {
                  return cell.value.toFixed(cell.numFmt.length - 2);
                }
                // Display cached results only; never evaluate a workbook formula.
                return String(
                  cell.type === ExcelJS.ValueType.Formula
                    ? (cell.result ?? '[Formula: no saved result]')
                    : cell.text,
                ).slice(0, 2000);
              }),
            );
          }
          return { name: sheet.name, rows };
        });
      return {
        kind: 'table',
        sheets,
        truncated:
          book.worksheets.length > 10 ||
          book.worksheets.some((sheet) => sheet.rowCount > 200 || sheet.columnCount > 40),
        note: 'Preview shows up to 10 visible sheets, 200 rows and 40 columns per sheet. Formulas use saved values; download for the complete workbook.',
      };
    }
    if (['text/csv', 'application/csv'].includes(mime)) {
      const rows = parse(buffer, {
        bom: true,
        to: 201,
        relax_column_count: true,
        max_record_size: 1024 * 1024,
      }) as string[][];
      return {
        kind: 'table',
        sheets: [
          {
            name: 'CSV',
            rows: rows
              .slice(0, 200)
              .map((row) => row.slice(0, 40).map((cell) => cell.slice(0, 2000))),
          },
        ],
        truncated: rows.length > 200 || rows.some((row) => row.length > 40),
        note: 'Preview shows up to 200 rows and 40 columns. Download to read the complete file.',
      };
    }
    if (['text/plain', 'application/json'].includes(mime))
      return textPreview(buffer.toString('utf8'));
    return {
      kind: 'download',
      note: 'Download this format to open it in a compatible application.',
    };
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException(
      'This file could not be previewed. It may be encrypted, damaged or an unsupported version. Download the original to open it.',
    );
  }
}
