import * as zlib from 'zlib';

export interface BusinessPdfImage {
  data: Buffer;
  mimeType: string;
}

export interface BusinessPdfOrganization {
  name: string;
  groupName?: string | null;
  companyName?: string | null;
  code?: string | null;
  branchName?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  tin?: string | null;
  vrn?: string | null;
  registrationNumber?: string | null;
  logoUrl?: string | null;
  logoText?: string | null;
  logoImage?: BusinessPdfImage | null;
}

export interface BusinessPdfTable {
  headers: string[];
  rows: string[][];
  numericColumns?: number[];
}

export interface BusinessPdfSection {
  title: string;
  items?: Array<{ label: string; value: string }>;
  paragraphs?: string[];
  table?: BusinessPdfTable;
  totals?: Array<{ label: string; value: string; emphasis?: boolean }>;
  signatures?: string[];
}

export interface BusinessPdfModel {
  title: string;
  subtitle?: string;
  reference: string;
  status?: string;
  organization: BusinessPdfOrganization;
  generatedAt: Date;
  meta: Array<{ label: string; value: string }>;
  sections: BusinessPdfSection[];
}

type FontName = 'F1' | 'F2';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

interface ParsedPdfImage {
  width: number;
  height: number;
  colorSpace: 'DeviceGray' | 'DeviceRGB' | 'DeviceCMYK';
  bitsPerComponent: number;
  filter: 'DCTDecode' | 'FlateDecode';
  data: Buffer;
  smask?: ParsedPdfImage;
}

interface RegisteredImage {
  name: string;
  image: ParsedPdfImage;
  objectId?: number;
  smaskObjectId?: number;
}

export function buildBusinessPdf(model: BusinessPdfModel): Buffer {
  const pdf = new SimplePdf();
  pdf.addHeader(model);
  for (const section of model.sections) pdf.addSection(section);
  pdf.addFooter();
  return pdf.toBuffer();
}

class SimplePdf {
  private pages: string[][] = [[]];
  private images: RegisteredImage[] = [];
  private y = MARGIN;

  addHeader(model: BusinessPdfModel) {
    const headerTop = this.y;
    const org = model.organization;
    const groupName = valueOrNull(org.groupName) ?? 'ITEMBA GROUP';
    const companyName = valueOrNull(org.name) ?? valueOrNull(org.companyName) ?? 'ITEMBA-R Group';
    const branchName = valueOrNull(org.branchName);
    const logoText = valueOrNull(org.logoText) ?? initials(groupName);

    this.rect(MARGIN, headerTop - 2, 54, 54, false, 0);
    const imageDrawn = org.logoImage ? this.image(org.logoImage, MARGIN + 4, headerTop + 2, 46, 46) : false;
    if (!imageDrawn) this.text(logoText, MARGIN + 13, headerTop + 31, 13, 'F2', 28, 'center');

    const orgX = MARGIN + 66;
    const orgWidth = 304;
    let orgY = headerTop;
    orgY = this.wrappedText(groupName.toUpperCase(), orgX, orgY, 12, orgWidth, 'F2') + 1;
    orgY = this.wrappedText(companyName, orgX, orgY, 10, orgWidth, 'F2') + 1;
    if (branchName) orgY = this.wrappedText(branchName, orgX, orgY, 9, orgWidth, 'F1') + 2;

    const address = valueOrNull(org.address);
    if (address) orgY = this.wrappedText(`Address: ${address}`, orgX, orgY, 8, orgWidth, 'F1') + 1;

    const contactLine = [
      valueOrNull(org.phone) ? `Tel: ${valueOrNull(org.phone)}` : null,
      valueOrNull(org.email) ? `Email: ${valueOrNull(org.email)}` : null,
    ].filter(Boolean).join(' | ');
    if (contactLine) orgY = this.wrappedText(contactLine, orgX, orgY, 8, orgWidth, 'F1') + 1;

    const taxLine = [
      valueOrNull(org.tin) ? `TIN: ${valueOrNull(org.tin)}` : null,
      valueOrNull(org.vrn) ? `VRN: ${valueOrNull(org.vrn)}` : null,
    ].filter(Boolean).join(' | ');
    if (taxLine) orgY = this.wrappedText(taxLine, orgX, orgY, 8, orgWidth, 'F1') + 1;

    const registrationNumber = valueOrNull(org.registrationNumber);
    if (registrationNumber) orgY = this.wrappedText(`Reg: ${registrationNumber}`, orgX, orgY, 8, orgWidth, 'F1') + 1;

    const rightX = PAGE_WIDTH - MARGIN - 160;
    this.text('DOCUMENT', rightX, headerTop + 2, 8, 'F2', 160, 'right');
    this.text(model.reference, rightX, headerTop + 16, 11, 'F2', 160, 'right');
    if (model.status) this.text(model.status, rightX, headerTop + 31, 8, 'F1', 160, 'right');

    this.y = Math.max(orgY, headerTop + 62);
    this.line(MARGIN, this.y, PAGE_WIDTH - MARGIN, this.y);
    this.y += 22;

    this.text(model.title.toUpperCase(), MARGIN, this.y, 20, 'F2');
    this.text(model.reference, PAGE_WIDTH - MARGIN - 180, this.y + 1, 12, 'F2', 180, 'right');
    this.y += 18;

    if (model.subtitle) {
      this.text(model.subtitle, MARGIN, this.y, 11, 'F1', 300);
    }
    this.y += 22;

    const generated = formatDateTime(model.generatedAt);
    const meta = [...model.meta, { label: 'Generated', value: generated }];
    this.keyValues(meta, 2);
    this.y += 8;
  }

  addSection(section: BusinessPdfSection) {
    this.ensureSpace(42);
    this.y += 8;
    this.text(section.title, MARGIN, this.y, 12, 'F2');
    this.y += 12;
    this.line(MARGIN, this.y, PAGE_WIDTH - MARGIN, this.y, 0.5);
    this.y += 12;

    if (section.items?.length) {
      this.keyValues(section.items, 2);
      this.y += 4;
    }

    for (const paragraph of section.paragraphs ?? []) {
      this.y = this.wrappedText(paragraph, MARGIN, this.y, 9, CONTENT_WIDTH, 'F1') + 8;
    }

    if (section.table) {
      this.table(section.table);
      this.y += 8;
    }

    if (section.totals?.length) {
      this.totals(section.totals);
      this.y += 8;
    }

    if (section.signatures?.length) {
      this.signatures(section.signatures);
    }
  }

  addFooter() {
    const pageCount = this.pages.length;
    for (let i = 0; i < pageCount; i += 1) {
      const previous = this.pages;
      this.pages = [previous[i]];
      this.text(`Page ${i + 1} of ${pageCount}`, PAGE_WIDTH - MARGIN - 120, PAGE_HEIGHT - 24, 8, 'F1', 120, 'right');
      this.pages = previous;
    }
  }

  toBuffer(): Buffer {
    const objects: string[] = [];
    const addObject = (content: string) => {
      objects.push(content);
      return objects.length;
    };

    const catalogId = addObject('<< /Type /Catalog /Pages 2 0 R >>');
    const pagesId = addObject('');
    const fontRegularId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const fontBoldId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    for (const registered of this.images) {
      if (registered.image.smask) {
        registered.smaskObjectId = addObject(imageObject(registered.image.smask));
      }
      registered.objectId = addObject(imageObject(registered.image, registered.smaskObjectId));
    }
    const xObjects = this.images
      .filter((image) => image.objectId)
      .map((image) => `/${image.name} ${image.objectId} 0 R`)
      .join(' ');
    const xObjectResources = xObjects ? `/XObject << ${xObjects} >> ` : '';
    const pageIds: number[] = [];

    for (const ops of this.pages) {
      const stream = ops.join('\n');
      const contentId = addObject(`<< /Length ${Buffer.byteLength(stream, 'binary')} >>\nstream\n${stream}\nendstream`);
      const pageId = addObject(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
          `/Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> ${xObjectResources}>> ` +
          `/Contents ${contentId} 0 R >>`,
      );
      pageIds.push(pageId);
    }

    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

    let body = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((content, index) => {
      offsets.push(Buffer.byteLength(body, 'binary'));
      body += `${index + 1} 0 obj\n${content}\nendobj\n`;
    });
    const xrefOffset = Buffer.byteLength(body, 'binary');
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => {
      body += `${String(offset).padStart(10, '0')} 00000 n \n`;
    });
    body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(body, 'binary');
  }

  private keyValues(items: Array<{ label: string; value: string }>, columns: 1 | 2) {
    const colWidth = CONTENT_WIDTH / columns;
    for (let i = 0; i < items.length; i += columns) {
      this.ensureSpace(22);
      const row = items.slice(i, i + columns);
      const startY = this.y;
      let rowHeight = 0;
      row.forEach((item, index) => {
        const x = MARGIN + index * colWidth;
        this.text(item.label.toUpperCase(), x, startY, 7, 'F2', colWidth - 12);
        const bottom = this.wrappedText(item.value || 'N/A', x, startY + 10, 9, colWidth - 12, 'F1');
        rowHeight = Math.max(rowHeight, bottom - startY);
      });
      this.y += Math.max(rowHeight, 24);
    }
  }

  private table(table: BusinessPdfTable) {
    const colWidths = distributeColumns(table.headers.length);
    this.tableHeader(table.headers, colWidths);

    for (const row of table.rows) {
      const rowLines = row.map((cell, index) => wrapText(cell, colWidths[index] - 8, 8));
      const lineCount = Math.max(...rowLines.map((lines) => lines.length), 1);
      const rowHeight = Math.max(18, lineCount * 10 + 8);
      if (!this.hasSpace(rowHeight + 12)) this.newPageWithTableHeader(table.headers, colWidths);

      const top = this.y;
      this.rect(MARGIN, top - 2, CONTENT_WIDTH, rowHeight, false, 0.85);
      rowLines.forEach((lines, index) => {
        const x = MARGIN + sum(colWidths.slice(0, index)) + 4;
        const align = table.numericColumns?.includes(index) ? 'right' : 'left';
        lines.forEach((line, lineIndex) => {
          this.text(line, x, top + 9 + lineIndex * 10, 8, 'F1', colWidths[index] - 8, align);
        });
      });
      this.y += rowHeight;
    }
  }

  private tableHeader(headers: string[], colWidths: number[]) {
    this.ensureSpace(28);
    this.rect(MARGIN, this.y - 2, CONTENT_WIDTH, 20, true, 0.94);
    headers.forEach((header, index) => {
      const x = MARGIN + sum(colWidths.slice(0, index)) + 4;
      this.text(header.toUpperCase(), x, this.y + 10, 7, 'F2', colWidths[index] - 8);
    });
    this.y += 22;
  }

  private newPageWithTableHeader(headers: string[], colWidths: number[]) {
    this.newPage();
    this.tableHeader(headers, colWidths);
  }

  private totals(items: Array<{ label: string; value: string; emphasis?: boolean }>) {
    const width = 210;
    const x = PAGE_WIDTH - MARGIN - width;
    for (const item of items) {
      this.ensureSpace(18);
      if (item.emphasis) this.rect(x, this.y - 3, width, 17, true, 0.95);
      this.text(item.label, x + 6, this.y + 8, 8, item.emphasis ? 'F2' : 'F1', 90);
      this.text(item.value, x + 96, this.y + 8, 8, item.emphasis ? 'F2' : 'F1', 108, 'right');
      this.y += 18;
    }
  }

  private signatures(labels: string[]) {
    const colWidth = CONTENT_WIDTH / labels.length;
    this.ensureSpace(52);
    labels.forEach((label, index) => {
      const x = MARGIN + index * colWidth;
      this.line(x, this.y + 28, x + colWidth - 18, this.y + 28, 0.5);
      this.text(label, x, this.y + 42, 8, 'F1', colWidth - 18);
    });
    this.y += 56;
  }

  private wrappedText(
    value: string,
    x: number,
    y: number,
    size: number,
    width: number,
    font: FontName,
  ) {
    const lines = wrapText(value, width, size);
    lines.forEach((line, index) => this.text(line, x, y + index * (size + 3), size, font, width));
    return y + lines.length * (size + 3);
  }

  private text(
    value: string,
    x: number,
    y: number,
    size: number,
    font: FontName,
    width?: number,
    align: 'left' | 'right' | 'center' = 'left',
  ) {
    const clean = cleanText(value);
    const approxWidth = clean.length * size * 0.48;
    const offset =
      align === 'right' && width
        ? Math.max(0, width - approxWidth)
        : align === 'center' && width
          ? Math.max(0, (width - approxWidth) / 2)
          : 0;
    this.current().push(
      `BT /${font} ${size} Tf 0 g 1 0 0 1 ${num(x + offset)} ${num(PAGE_HEIGHT - y)} Tm (${escapePdf(clean)}) Tj ET`,
    );
  }

  private line(x1: number, y1: number, x2: number, y2: number, width = 0.8) {
    this.current().push(
      `${num(width)} w ${num(x1)} ${num(PAGE_HEIGHT - y1)} m ${num(x2)} ${num(PAGE_HEIGHT - y2)} l S`,
    );
  }

  private rect(x: number, y: number, width: number, height: number, fill: boolean, gray: number) {
    this.current().push(
      `${num(gray)} g ${num(x)} ${num(PAGE_HEIGHT - y - height)} ${num(width)} ${num(height)} re ${fill ? 'f' : 'S'} 0 g`,
    );
  }

  private image(image: BusinessPdfImage, x: number, y: number, width: number, height: number) {
    try {
      const parsed = parsePdfImage(image);
      const name = `Im${this.images.length + 1}`;
      this.images.push({ name, image: parsed });

      const scale = Math.min(width / parsed.width, height / parsed.height);
      const drawWidth = parsed.width * scale;
      const drawHeight = parsed.height * scale;
      const drawX = x + (width - drawWidth) / 2;
      const drawY = y + (height - drawHeight) / 2;
      this.current().push(
        `q ${num(drawWidth)} 0 0 ${num(drawHeight)} ${num(drawX)} ${num(PAGE_HEIGHT - drawY - drawHeight)} cm /${name} Do Q`,
      );
      return true;
    } catch {
      return false;
    }
  }

  private ensureSpace(height: number) {
    if (!this.hasSpace(height)) this.newPage();
  }

  private hasSpace(height: number) {
    return this.y + height <= PAGE_HEIGHT - MARGIN;
  }

  private newPage() {
    this.pages.push([]);
    this.y = MARGIN;
  }

  private current() {
    return this.pages[this.pages.length - 1];
  }
}

function imageObject(image: ParsedPdfImage, smaskObjectId?: number) {
  const smask = smaskObjectId ? ` /SMask ${smaskObjectId} 0 R` : '';
  const decode = image.colorSpace === 'DeviceCMYK' ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
  return (
    `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
    `/ColorSpace /${image.colorSpace} /BitsPerComponent ${image.bitsPerComponent} ` +
    `/Filter /${image.filter}${smask}${decode} /Length ${image.data.byteLength} >>\n` +
    `stream\n${image.data.toString('binary')}\nendstream`
  );
}

function parsePdfImage(image: BusinessPdfImage): ParsedPdfImage {
  if (image.data.length >= 3 && image.data[0] === 0xff && image.data[1] === 0xd8) {
    return parseJpegImage(image.data);
  }
  if (image.data.length >= 8 && image.data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return parsePngImage(image.data);
  }
  throw new Error(`Unsupported logo image type: ${image.mimeType}`);
}

function parseJpegImage(data: Buffer): ParsedPdfImage {
  let offset = 2;
  while (offset < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < data.length && data[offset] === 0xff) offset += 1;
    const marker = data[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > data.length) break;

    const segmentLength = data.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > data.length) break;

    if (isJpegStartOfFrame(marker)) {
      const bitsPerComponent = data[offset + 2];
      const height = data.readUInt16BE(offset + 3);
      const width = data.readUInt16BE(offset + 5);
      const components = data[offset + 7];
      const colorSpace = jpegColorSpace(components);
      return {
        width,
        height,
        colorSpace,
        bitsPerComponent,
        filter: 'DCTDecode',
        data,
      };
    }

    offset += segmentLength;
  }
  throw new Error('Could not read JPEG logo dimensions');
}

function isJpegStartOfFrame(marker: number) {
  return [
    0xc0,
    0xc1,
    0xc2,
    0xc3,
    0xc5,
    0xc6,
    0xc7,
    0xc9,
    0xca,
    0xcb,
    0xcd,
    0xce,
    0xcf,
  ].includes(marker);
}

function jpegColorSpace(components: number): ParsedPdfImage['colorSpace'] {
  if (components === 1) return 'DeviceGray';
  if (components === 3) return 'DeviceRGB';
  if (components === 4) return 'DeviceCMYK';
  throw new Error(`Unsupported JPEG color component count: ${components}`);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function parsePngImage(data: Buffer): ParsedPdfImage {
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let compression = 0;
  let filter = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const idatChunks: Buffer[] = [];

  let offset = 8;
  while (offset + 8 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + length;
    if (chunkEnd + 4 > data.length) throw new Error('Invalid PNG chunk length');
    const chunk = data.subarray(chunkStart, chunkEnd);

    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
      compression = chunk[10];
      filter = chunk[11];
      interlace = chunk[12];
    } else if (type === 'PLTE') {
      palette = chunk;
    } else if (type === 'tRNS') {
      transparency = chunk;
    } else if (type === 'IDAT') {
      idatChunks.push(chunk);
    } else if (type === 'IEND') {
      break;
    }

    offset = chunkEnd + 4;
  }

  if (!width || !height || !idatChunks.length) throw new Error('Invalid PNG logo');
  if (bitDepth !== 8) throw new Error('Only 8-bit PNG logos are supported');
  if (compression !== 0 || filter !== 0 || interlace !== 0) {
    throw new Error('Unsupported PNG logo encoding');
  }

  const channels = pngChannels(colorType);
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const pixels = unfilterPng(inflated, width, height, channels);
  return pngPixelsToImage(width, height, colorType, pixels, palette, transparency);
}

function pngChannels(colorType: number) {
  if (colorType === 0) return 1;
  if (colorType === 2) return 3;
  if (colorType === 3) return 1;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  throw new Error(`Unsupported PNG color type: ${colorType}`);
}

function unfilterPng(raw: Buffer, width: number, height: number, channels: number) {
  const bytesPerLine = width * channels;
  const output = Buffer.alloc(bytesPerLine * height);
  let rawOffset = 0;
  let outputOffset = 0;
  let previous = Buffer.alloc(bytesPerLine);

  for (let y = 0; y < height; y += 1) {
    const filterType = raw[rawOffset];
    rawOffset += 1;
    const scanline = raw.subarray(rawOffset, rawOffset + bytesPerLine);
    rawOffset += bytesPerLine;
    if (scanline.length !== bytesPerLine) throw new Error('Invalid PNG scanline length');

    const current = Buffer.alloc(bytesPerLine);
    for (let i = 0; i < bytesPerLine; i += 1) {
      const left = i >= channels ? current[i - channels] : 0;
      const up = previous[i] ?? 0;
      const upLeft = i >= channels ? previous[i - channels] : 0;
      const predictor = pngPredictor(filterType, left, up, upLeft);
      current[i] = (scanline[i] + predictor) & 0xff;
    }
    current.copy(output, outputOffset);
    outputOffset += bytesPerLine;
    previous = current;
  }

  return output;
}

function pngPredictor(filterType: number, left: number, up: number, upLeft: number) {
  switch (filterType) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return Math.floor((left + up) / 2);
    case 4:
      return paeth(left, up, upLeft);
    default:
      throw new Error(`Unsupported PNG filter type: ${filterType}`);
  }
}

function paeth(left: number, up: number, upLeft: number) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function pngPixelsToImage(
  width: number,
  height: number,
  colorType: number,
  pixels: Buffer,
  palette: Buffer | null,
  transparency: Buffer | null,
): ParsedPdfImage {
  const rgb = Buffer.alloc(width * height * 3);
  const alpha = Buffer.alloc(width * height, 255);
  let hasAlpha = false;

  const setPixel = (index: number, red: number, green: number, blue: number, opacity: number) => {
    const rgbOffset = index * 3;
    rgb[rgbOffset] = red;
    rgb[rgbOffset + 1] = green;
    rgb[rgbOffset + 2] = blue;
    alpha[index] = opacity;
    if (opacity !== 255) hasAlpha = true;
  };

  const transparentGray = transparency && transparency.length >= 2 ? transparency.readUInt16BE(0) : null;
  const transparentRed = transparency && transparency.length >= 6 ? transparency.readUInt16BE(0) : null;
  const transparentGreen = transparency && transparency.length >= 6 ? transparency.readUInt16BE(2) : null;
  const transparentBlue = transparency && transparency.length >= 6 ? transparency.readUInt16BE(4) : null;

  for (let index = 0; index < width * height; index += 1) {
    if (colorType === 0) {
      const gray = pixels[index];
      const opacity = transparentGray !== null && gray === transparentGray ? 0 : 255;
      setPixel(index, gray, gray, gray, opacity);
    } else if (colorType === 2) {
      const offset = index * 3;
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const opacity =
        transparentRed !== null &&
        transparentGreen !== null &&
        transparentBlue !== null &&
        red === transparentRed &&
        green === transparentGreen &&
        blue === transparentBlue
          ? 0
          : 255;
      setPixel(index, red, green, blue, opacity);
    } else if (colorType === 3) {
      if (!palette) throw new Error('Indexed PNG logo is missing a palette');
      const paletteIndex = pixels[index];
      const paletteOffset = paletteIndex * 3;
      const red = palette[paletteOffset] ?? 0;
      const green = palette[paletteOffset + 1] ?? 0;
      const blue = palette[paletteOffset + 2] ?? 0;
      const opacity = transparency && paletteIndex < transparency.length ? transparency[paletteIndex] : 255;
      setPixel(index, red, green, blue, opacity);
    } else if (colorType === 4) {
      const offset = index * 2;
      const gray = pixels[offset];
      const opacity = pixels[offset + 1];
      setPixel(index, gray, gray, gray, opacity);
    } else if (colorType === 6) {
      const offset = index * 4;
      setPixel(index, pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]);
    } else {
      throw new Error(`Unsupported PNG color type: ${colorType}`);
    }
  }

  const image: ParsedPdfImage = {
    width,
    height,
    colorSpace: 'DeviceRGB',
    bitsPerComponent: 8,
    filter: 'FlateDecode',
    data: zlib.deflateSync(rgb),
  };

  if (hasAlpha) {
    image.smask = {
      width,
      height,
      colorSpace: 'DeviceGray',
      bitsPerComponent: 8,
      filter: 'FlateDecode',
      data: zlib.deflateSync(alpha),
    };
  }

  return image;
}

function wrapText(value: string, width: number, size: number): string[] {
  const maxChars = Math.max(8, Math.floor(width / (size * 0.48)));
  const words = cleanText(value || 'N/A').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (!line) {
      line = word;
    } else if (`${line} ${word}`.length <= maxChars) {
      line = `${line} ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ['N/A'];
}

function distributeColumns(count: number) {
  if (count <= 0) return [];
  const base = CONTENT_WIDTH / count;
  return Array.from({ length: count }, () => base);
}

function cleanText(value: string) {
  return String(value ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function valueOrNull(value: unknown) {
  const text = cleanText(String(value ?? ''));
  return text ? text : null;
}

function initials(name: string) {
  const parts = cleanText(name)
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return 'IR';
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function escapePdf(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Nairobi',
  }).format(value);
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function num(value: number) {
  return Number(value.toFixed(2));
}
