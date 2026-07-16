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
  telephone?: string | null;
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
  /** Relative widths for each column. Invalid/missing weights fall back to equal columns. */
  columnWeights?: number[];
  /** Alternating row tint for dense analytical reports. */
  stripedRows?: boolean;
  /** Column indexes rendered in muted text (e.g. SKU/code columns). */
  mutedColumns?: number[];
}

export interface BusinessPdfSection {
  title: string;
  /** Starts this section on a clean continuation page. */
  pageBreakBefore?: boolean;
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
  orientation?: 'portrait' | 'landscape';
  organization: BusinessPdfOrganization;
  generatedAt: Date;
  meta: Array<{ label: string; value: string }>;
  sections: BusinessPdfSection[];
}

type FontName = 'F1' | 'F2';

type Rgb = readonly [number, number, number];

const PORTRAIT_WIDTH = 595.28;
const PORTRAIT_HEIGHT = 841.89;
const MARGIN = 42;

// Design tokens — PDF mirror (0-1 RGB) of the frontend Tailwind palette used
// by the document print pages. Keep in sync with frontend/tailwind.config.ts.
const BRAND: Rgb = [0.145, 0.388, 0.922]; // brand-600 #2563eb
const BRAND_TINT: Rgb = [0.937, 0.965, 1.0]; // brand-50 #eff6ff
const BRAND_TINT_STRONG: Rgb = [0.859, 0.918, 0.996]; // brand-100 #dbeafe
const TEXT_DARK: Rgb = [0.059, 0.09, 0.165]; // slate-900 #0f172a
const TEXT_MUTED: Rgb = [0.392, 0.455, 0.545]; // slate-500 #64748b
const HAIRLINE: Rgb = [0.886, 0.91, 0.941]; // slate-200 #e2e8f0
const PANEL: Rgb = [0.973, 0.98, 0.988]; // slate-50 #f8fafc
const SIGNATURE_LINE: Rgb = [0.58, 0.639, 0.722]; // slate-400 #94a3b8

// Conservative average glyph-width factor (em) for Helvetica-Bold uppercase —
// used to size the header title and status pill so they never overhang the
// right margin (the generic 0.48 factor in text() underestimates bold caps).
const TITLE_WIDTH_FACTOR = 0.56;

type StatusToneName = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

// Status pill tones: *-700 text on *-50 fill, mirroring the frontend
// statusToneClasses palette used by DocumentShell.
const STATUS_TONES: Record<StatusToneName, { text: Rgb; fill: Rgb }> = {
  success: { text: [0.016, 0.471, 0.341], fill: [0.925, 0.992, 0.961] }, // emerald-700 / emerald-50
  warning: { text: [0.706, 0.325, 0.035], fill: [1.0, 0.984, 0.922] }, // amber-700 / amber-50
  danger: { text: [0.725, 0.11, 0.11], fill: [0.996, 0.949, 0.949] }, // red-700 / red-50
  info: { text: [0.114, 0.306, 0.847], fill: [0.937, 0.965, 1.0] }, // blue-700 / blue-50
  neutral: { text: [0.2, 0.255, 0.333], fill: [0.973, 0.98, 0.988] }, // slate-700 / slate-50
};

// Line-for-line port of documentStatusTone() in
// frontend/src/components/documents/document-utils.ts — that file is the
// source of truth for this keyword mapping; keep the two in sync.
function statusTone(status: string | null | undefined): StatusToneName {
  const normalized = String(status ?? '').toLowerCase();
  if (
    normalized.includes('paid') ||
    normalized.includes('accepted') ||
    normalized.includes('delivered') ||
    normalized.includes('closed')
  ) {
    return 'success';
  }
  if (
    normalized.includes('draft') ||
    normalized.includes('sent') ||
    normalized.includes('confirmed') ||
    normalized.includes('transit')
  ) {
    return 'info';
  }
  if (
    normalized.includes('partial') ||
    normalized.includes('pending') ||
    normalized.includes('expired')
  ) {
    return 'warning';
  }
  if (
    normalized.includes('cancel') ||
    normalized.includes('reject') ||
    normalized.includes('void')
  ) {
    return 'danger';
  }
  return 'neutral';
}

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
  const pdf = new SimplePdf(model.orientation);
  pdf.addHeader(model);
  for (const section of model.sections) pdf.addSection(section);
  pdf.addFooter(model);
  return pdf.toBuffer();
}

class SimplePdf {
  private pages: string[][] = [[]];
  private images: RegisteredImage[] = [];
  private y = MARGIN;
  private readonly pageWidth: number;
  private readonly pageHeight: number;
  private readonly contentWidth: number;
  private documentTitle = '';
  private documentReference = '';

  constructor(orientation: BusinessPdfModel['orientation'] = 'portrait') {
    this.pageWidth = orientation === 'landscape' ? PORTRAIT_HEIGHT : PORTRAIT_WIDTH;
    this.pageHeight = orientation === 'landscape' ? PORTRAIT_WIDTH : PORTRAIT_HEIGHT;
    this.contentWidth = this.pageWidth - MARGIN * 2;
  }

  addHeader(model: BusinessPdfModel) {
    this.documentTitle = cleanText(model.title).toUpperCase();
    this.documentReference = cleanText(model.reference);
    this.brandRule();
    const headerTop = this.y;
    const org = model.organization;
    const groupName = valueOrNull(org.groupName) ?? 'ITEMBA GROUP';
    const companyName = valueOrNull(org.name) ?? valueOrNull(org.companyName) ?? 'ITEMBA-R Group';
    const branchName = valueOrNull(org.branchName);
    const logoText = valueOrNull(org.logoText) ?? initials(groupName);

    const imageDrawn = org.logoImage ? this.image(org.logoImage, MARGIN, headerTop, 48, 48) : false;
    if (!imageDrawn) this.text(logoText, MARGIN, headerTop + 30, 20, 'F2', 48, 'center', BRAND);

    const orgX = MARGIN + 60;
    const rightWidth = Math.min(240, this.contentWidth * 0.4);
    const orgWidth = Math.max(140, this.contentWidth - 60 - rightWidth - 18);
    let orgY = headerTop;
    orgY = this.wrappedText(groupName.toUpperCase(), orgX, orgY, 12, orgWidth, 'F2', TEXT_DARK) + 1;
    orgY = this.wrappedText(companyName, orgX, orgY, 9.5, orgWidth, 'F2', TEXT_DARK) + 1;
    if (branchName)
      orgY = this.wrappedText(branchName, orgX, orgY, 8.5, orgWidth, 'F1', TEXT_MUTED) + 2;

    const address = valueOrNull(org.address);
    if (address)
      orgY =
        this.wrappedText(`Address: ${address}`, orgX, orgY, 7.5, orgWidth, 'F1', TEXT_MUTED) + 1;

    const phoneLine = [
      valueOrNull(org.telephone) ? `Tel: ${valueOrNull(org.telephone)}` : null,
      valueOrNull(org.phone) ? `Phone: ${valueOrNull(org.phone)}` : null,
    ]
      .filter(Boolean)
      .join(' | ');
    if (phoneLine)
      orgY = this.wrappedText(phoneLine, orgX, orgY, 7.5, orgWidth, 'F1', TEXT_MUTED) + 1;

    const email = valueOrNull(org.email);
    if (email)
      orgY = this.wrappedText(`Email: ${email}`, orgX, orgY, 7.5, orgWidth, 'F1', TEXT_MUTED) + 1;

    const taxLine = [
      valueOrNull(org.tin) ? `TIN: ${valueOrNull(org.tin)}` : null,
      valueOrNull(org.vrn) ? `VRN: ${valueOrNull(org.vrn)}` : null,
    ]
      .filter(Boolean)
      .join(' | ');
    if (taxLine) orgY = this.wrappedText(taxLine, orgX, orgY, 7.5, orgWidth, 'F1', TEXT_MUTED) + 1;

    const registrationNumber = valueOrNull(org.registrationNumber);
    if (registrationNumber)
      orgY =
        this.wrappedText(
          `Reg No: ${registrationNumber}`,
          orgX,
          orgY,
          7.5,
          orgWidth,
          'F1',
          TEXT_MUTED,
        ) + 1;

    // Right block: document type (large caps), number in brand color, status pill.
    const rightX = this.pageWidth - MARGIN - rightWidth;
    const docTitle = cleanText(model.title).toUpperCase();
    const titleSize = docTitle.length * 17 * TITLE_WIDTH_FACTOR > rightWidth ? 14 : 17;
    const titleWidth = Math.min(rightWidth, docTitle.length * titleSize * TITLE_WIDTH_FACTOR);
    this.text(
      docTitle,
      this.pageWidth - MARGIN - titleWidth,
      headerTop + 12,
      titleSize,
      'F2',
      undefined,
      'left',
      TEXT_DARK,
    );
    this.text(model.reference, rightX, headerTop + 26, 10.5, 'F2', rightWidth, 'right', BRAND);
    if (model.status) {
      const statusText = cleanText(model.status).toUpperCase();
      const tone = STATUS_TONES[statusTone(model.status)];
      const pillWidth = statusText.length * 7 * TITLE_WIDTH_FACTOR + 14;
      const pillX = this.pageWidth - MARGIN - pillWidth;
      const pillTop = headerTop + 33;
      this.rect(pillX, pillTop, pillWidth, 14, true, tone.fill);
      this.text(statusText, pillX + 7, pillTop + 10, 7, 'F2', undefined, 'left', tone.text);
    }

    this.y = Math.max(orgY, headerTop + 62);
    this.line(MARGIN, this.y, this.pageWidth - MARGIN, this.y, 0.7, HAIRLINE);
    this.y += 14;

    if (model.subtitle) {
      this.text(model.subtitle, MARGIN, this.y, 9.5, 'F1', 320, 'left', TEXT_MUTED);
      this.y += 16;
    }

    this.metaStrip(model.meta);
    this.y += 8;
  }

  /** Full-bleed 3pt brand accent bar at the very top of the page (chrome only — never moves this.y). */
  private brandRule() {
    this.rect(0, 0, this.pageWidth, 3, true, BRAND);
  }

  /** Whitespace-separated label-over-value pairs between two hairlines, up to 4 columns per band. */
  private metaStrip(items: Array<{ label: string; value: string }>) {
    if (!items.length) return;
    const columns = Math.min(items.length, 4);
    const colWidth = this.contentWidth / columns;
    this.ensureSpace(40);
    this.line(MARGIN, this.y, this.pageWidth - MARGIN, this.y, 0.7, HAIRLINE);
    this.y += 11;
    for (let i = 0; i < items.length; i += columns) {
      this.ensureSpace(26);
      const band = items.slice(i, i + columns);
      const startY = this.y;
      let bandHeight = 0;
      band.forEach((item, index) => {
        const x = MARGIN + index * colWidth;
        this.text(
          item.label.toUpperCase(),
          x,
          startY,
          6.5,
          'F2',
          colWidth - 10,
          'left',
          TEXT_MUTED,
        );
        const bottom = this.wrappedText(
          item.value || 'N/A',
          x,
          startY + 11,
          9,
          colWidth - 10,
          'F1',
          TEXT_DARK,
        );
        bandHeight = Math.max(bandHeight, bottom - startY);
      });
      this.y += Math.max(bandHeight, 24);
    }
    this.line(MARGIN, this.y - 6, this.pageWidth - MARGIN, this.y - 6, 0.7, HAIRLINE);
  }

  addSection(section: BusinessPdfSection) {
    if (section.pageBreakBefore) this.newPage();
    const signatureOnly =
      !!section.signatures?.length &&
      !section.items?.length &&
      !section.paragraphs?.length &&
      !section.table &&
      !section.totals?.length;
    this.ensureSpace(signatureOnly ? 70 : 36);
    this.y += 5;
    this.text(section.title.toUpperCase(), MARGIN, this.y, 9, 'F2', undefined, 'left', TEXT_MUTED);
    this.y += 7;
    this.line(MARGIN, this.y, this.pageWidth - MARGIN, this.y, 0.7, HAIRLINE);
    this.y += 9;

    if (section.items?.length) {
      this.keyValues(section.items, 2);
      this.y += 4;
    }

    const isNotesPanel =
      !!section.paragraphs?.length &&
      !section.items?.length &&
      !section.table &&
      !section.totals?.length &&
      !section.signatures?.length;
    if (isNotesPanel) {
      this.notesPanel(section.paragraphs ?? []);
    } else {
      for (const paragraph of section.paragraphs ?? []) {
        this.y =
          this.wrappedText(paragraph, MARGIN, this.y, 9, this.contentWidth, 'F1', TEXT_DARK) + 8;
      }
    }

    if (section.table) {
      this.table(section.table);
      this.y += 5;
    }

    if (section.totals?.length) {
      this.totals(section.totals);
      this.y += 5;
    }

    if (section.signatures?.length) {
      this.signatures(section.signatures);
    }
  }

  addFooter(model: BusinessPdfModel) {
    const pageCount = this.pages.length;
    const org = model.organization;
    const contactLine = [
      valueOrNull(org.website),
      valueOrNull(org.email),
      valueOrNull(org.telephone) ? `Tel: ${valueOrNull(org.telephone)}` : null,
      valueOrNull(org.phone) ? `Phone: ${valueOrNull(org.phone)}` : null,
    ]
      .filter(Boolean)
      .join('  |  ');
    const generated = `Generated ${formatDateTime(model.generatedAt)}`;
    for (let i = 0; i < pageCount; i += 1) {
      const previous = this.pages;
      this.pages = [previous[i]];
      this.line(
        MARGIN,
        this.pageHeight - 34,
        this.pageWidth - MARGIN,
        this.pageHeight - 34,
        0.7,
        HAIRLINE,
      );
      if (contactLine) {
        this.text(
          contactLine,
          MARGIN,
          this.pageHeight - 24,
          5.8,
          'F1',
          this.contentWidth - 205,
          'left',
          TEXT_MUTED,
        );
      }
      this.text(
        `${generated}  |  Page ${i + 1} of ${pageCount}`,
        this.pageWidth - MARGIN - 200,
        this.pageHeight - 24,
        6.2,
        'F1',
        200,
        'right',
        TEXT_MUTED,
      );
      this.pages = previous;
    }
  }

  /** Notes/terms rendered on a light panel; falls back to plain paragraphs when too tall for one page. */
  private notesPanel(paragraphs: string[]) {
    const inset = 10;
    const lineHeight = 12; // 9pt text + 3pt leading, matching wrappedText
    const blocks = paragraphs.map((paragraph) =>
      wrapText(paragraph, this.contentWidth - inset * 2, 9),
    );
    const totalLines = blocks.reduce((count, lines) => count + lines.length, 0);
    const panelHeight = totalLines * lineHeight + (blocks.length - 1) * 8 + inset * 2 - 2;
    if (panelHeight > this.pageHeight - MARGIN * 2) {
      for (const paragraph of paragraphs) {
        this.y =
          this.wrappedText(paragraph, MARGIN, this.y, 9, this.contentWidth, 'F1', TEXT_DARK) + 8;
      }
      return;
    }
    this.ensureSpace(panelHeight + 8);
    const panelTop = this.y - 2;
    this.rect(MARGIN, panelTop, this.contentWidth, panelHeight, true, PANEL);
    let baseline = panelTop + inset + 7;
    for (const lines of blocks) {
      lines.forEach((line, index) => {
        this.text(
          line,
          MARGIN + inset,
          baseline + index * lineHeight,
          9,
          'F1',
          this.contentWidth - inset * 2,
          'left',
          TEXT_DARK,
        );
      });
      baseline += lines.length * lineHeight + 8;
    }
    this.y = panelTop + panelHeight + 10;
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
      const contentId = addObject(
        `<< /Length ${Buffer.byteLength(stream, 'binary')} >>\nstream\n${stream}\nendstream`,
      );
      const pageId = addObject(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] ` +
          `/Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> ${xObjectResources}>> ` +
          `/Contents ${contentId} 0 R >>`,
      );
      pageIds.push(pageId);
    }

    objects[pagesId - 1] =
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

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
    const colWidth = this.contentWidth / columns;
    for (let i = 0; i < items.length; i += columns) {
      this.ensureSpace(22);
      const row = items.slice(i, i + columns);
      const startY = this.y;
      let rowHeight = 0;
      row.forEach((item, index) => {
        const x = MARGIN + index * colWidth;
        this.text(item.label.toUpperCase(), x, startY, 7, 'F2', colWidth - 12, 'left', TEXT_MUTED);
        const bottom = this.wrappedText(
          item.value || 'N/A',
          x,
          startY + 10,
          9,
          colWidth - 12,
          'F1',
          TEXT_DARK,
        );
        rowHeight = Math.max(rowHeight, bottom - startY);
      });
      this.y += Math.max(rowHeight, 24);
    }
  }

  private table(table: BusinessPdfTable) {
    const colWidths = distributeColumns(
      table.headers.length,
      this.contentWidth,
      table.columnWeights,
    );
    this.tableHeader(table.headers, colWidths, table.numericColumns);

    for (const [rowIndex, row] of table.rows.entries()) {
      const rowLines = row.map((cell, index) => wrapText(cell, colWidths[index] - 8, 8));
      const lineCount = Math.max(...rowLines.map((lines) => lines.length), 1);
      const rowHeight = Math.max(18, lineCount * 10 + 8);
      if (!this.hasSpace(rowHeight + 4)) {
        this.newPageWithTableHeader(table.headers, colWidths, table.numericColumns);
      }

      const top = this.y;
      if (table.stripedRows && rowIndex % 2 === 1) {
        this.rect(MARGIN, top - 2, this.contentWidth, rowHeight, true, PANEL);
      }
      for (let index = 1; index < colWidths.length; index += 1) {
        const separatorX = MARGIN + sum(colWidths.slice(0, index));
        this.line(separatorX, top - 2, separatorX, top + rowHeight - 2, 0.35, HAIRLINE);
      }
      rowLines.forEach((lines, index) => {
        const x = MARGIN + sum(colWidths.slice(0, index)) + 4;
        const align = table.numericColumns?.includes(index) ? 'right' : 'left';
        const color = table.mutedColumns?.includes(index) ? TEXT_MUTED : TEXT_DARK;
        lines.forEach((line, lineIndex) => {
          this.text(
            line,
            x,
            top + 10 + lineIndex * 10,
            8,
            'F1',
            colWidths[index] - 8,
            align,
            color,
          );
        });
      });
      this.line(
        MARGIN,
        top + rowHeight - 2,
        this.pageWidth - MARGIN,
        top + rowHeight - 2,
        0.6,
        HAIRLINE,
      );
      this.y += rowHeight;
    }
  }

  private tableHeader(headers: string[], colWidths: number[], numericColumns?: number[]) {
    const wrappedHeaders = headers.map((header, index) =>
      wrapText(header.toUpperCase(), colWidths[index] - 8, 7),
    );
    const lineCount = Math.max(...wrappedHeaders.map((lines) => lines.length), 1);
    const headerHeight = Math.max(20, lineCount * 8 + 8);
    this.ensureSpace(headerHeight + 8);
    this.rect(MARGIN, this.y - 2, this.contentWidth, headerHeight, true, BRAND_TINT);
    for (let index = 1; index < colWidths.length; index += 1) {
      const separatorX = MARGIN + sum(colWidths.slice(0, index));
      this.line(separatorX, this.y - 2, separatorX, this.y + headerHeight - 2, 0.4, HAIRLINE);
    }
    wrappedHeaders.forEach((lines, index) => {
      const x = MARGIN + sum(colWidths.slice(0, index)) + 4;
      const align = numericColumns?.includes(index) ? 'right' : 'left';
      lines.forEach((line, lineIndex) => {
        this.text(line, x, this.y + 9 + lineIndex * 8, 7, 'F2', colWidths[index] - 8, align, BRAND);
      });
    });
    this.line(
      MARGIN,
      this.y + headerHeight - 2,
      this.pageWidth - MARGIN,
      this.y + headerHeight - 2,
      0.7,
      HAIRLINE,
    );
    this.y += headerHeight + 2;
  }

  private newPageWithTableHeader(
    headers: string[],
    colWidths: number[],
    numericColumns?: number[],
  ) {
    this.newPage();
    this.tableHeader(headers, colWidths, numericColumns);
  }

  private totals(items: Array<{ label: string; value: string; emphasis?: boolean }>) {
    const width = 220;
    const x = this.pageWidth - MARGIN - width;
    this.ensureSpace(items.length * 18);
    for (const item of items) {
      if (item.emphasis) {
        this.rect(x, this.y - 3, width, 18, true, BRAND_TINT_STRONG);
        this.text(item.label, x + 8, this.y + 8, 8.5, 'F2', 100, 'left', TEXT_DARK);
        this.text(item.value, x + 100, this.y + 8, 8.5, 'F2', width - 108, 'right', TEXT_DARK);
      } else {
        this.text(item.label, x + 8, this.y + 8, 8, 'F1', 100, 'left', TEXT_MUTED);
        this.text(item.value, x + 100, this.y + 8, 8, 'F1', width - 108, 'right', TEXT_DARK);
        this.line(x, this.y + 13, x + width, this.y + 13, 0.6, HAIRLINE);
      }
      this.y += 18;
    }
  }

  private signatures(labels: string[]) {
    const colWidth = this.contentWidth / labels.length;
    this.ensureSpace(42);
    this.y += 4;
    labels.forEach((label, index) => {
      const x = MARGIN + index * colWidth;
      this.line(x, this.y + 18, x + colWidth - 18, this.y + 18, 0.8, SIGNATURE_LINE);
      this.text(label, x, this.y + 29, 8, 'F1', colWidth - 18, 'left', TEXT_MUTED);
    });
    this.y += 38;
  }

  private wrappedText(
    value: string,
    x: number,
    y: number,
    size: number,
    width: number,
    font: FontName,
    color?: Rgb,
  ) {
    const lines = wrapText(value, width, size);
    lines.forEach((line, index) =>
      this.text(line, x, y + index * (size + 3), size, font, width, 'left', color),
    );
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
    color?: Rgb,
  ) {
    const clean = cleanText(value);
    const approxWidth = clean.length * size * (font === 'F2' ? 0.58 : 0.55);
    const offset =
      align === 'right' && width
        ? Math.max(0, width - approxWidth)
        : align === 'center' && width
          ? Math.max(0, (width - approxWidth) / 2)
          : 0;
    const fill = color ? `${num(color[0])} ${num(color[1])} ${num(color[2])} rg` : '0 g';
    this.current().push(
      `BT /${font} ${size} Tf ${fill} 1 0 0 1 ${num(x + offset)} ${num(this.pageHeight - y)} Tm (${escapePdf(clean)}) Tj ET`,
    );
  }

  private line(x1: number, y1: number, x2: number, y2: number, width = 0.8, color?: Rgb) {
    const stroke = color ? `${num(color[0])} ${num(color[1])} ${num(color[2])} RG ` : '';
    const reset = color ? ' 0 G' : '';
    this.current().push(
      `${stroke}${num(width)} w ${num(x1)} ${num(this.pageHeight - y1)} m ${num(x2)} ${num(this.pageHeight - y2)} l S${reset}`,
    );
  }

  private rect(
    x: number,
    y: number,
    width: number,
    height: number,
    fill: boolean,
    shade: number | Rgb,
  ) {
    const box = `${num(x)} ${num(this.pageHeight - y - height)} ${num(width)} ${num(height)} re`;
    if (typeof shade === 'number') {
      this.current().push(`${num(shade)} g ${box} ${fill ? 'f' : 'S'} 0 g`);
      return;
    }
    const color = `${num(shade[0])} ${num(shade[1])} ${num(shade[2])}`;
    this.current().push(fill ? `${color} rg ${box} f 0 g` : `${color} RG ${box} S 0 G`);
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
        `q ${num(drawWidth)} 0 0 ${num(drawHeight)} ${num(drawX)} ${num(this.pageHeight - drawY - drawHeight)} cm /${name} Do Q`,
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
    return this.y + height <= this.pageHeight - MARGIN;
  }

  private newPage() {
    this.pages.push([]);
    this.y = MARGIN;
    this.brandRule();
    if (this.documentTitle) {
      this.text(
        this.documentTitle,
        MARGIN,
        this.y + 8,
        8,
        'F2',
        this.contentWidth - 250,
        'left',
        TEXT_DARK,
      );
      this.text(
        `${this.documentReference} | CONTINUED`,
        this.pageWidth - MARGIN - 240,
        this.y + 8,
        7.5,
        'F1',
        240,
        'right',
        TEXT_MUTED,
      );
      this.y += 17;
      this.line(MARGIN, this.y, this.pageWidth - MARGIN, this.y, 0.7, HAIRLINE);
      this.y += 10;
    }
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
  return [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
    marker,
  );
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

  const transparentGray =
    transparency && transparency.length >= 2 ? transparency.readUInt16BE(0) : null;
  const transparentRed =
    transparency && transparency.length >= 6 ? transparency.readUInt16BE(0) : null;
  const transparentGreen =
    transparency && transparency.length >= 6 ? transparency.readUInt16BE(2) : null;
  const transparentBlue =
    transparency && transparency.length >= 6 ? transparency.readUInt16BE(4) : null;

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
      const opacity =
        transparency && paletteIndex < transparency.length ? transparency[paletteIndex] : 255;
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
  const maxChars = Math.max(8, Math.floor(width / (size * 0.58)));
  const words = cleanText(value || 'N/A')
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => {
      if (word.length <= maxChars) return [word];
      const chunks: string[] = [];
      for (let offset = 0; offset < word.length; offset += maxChars) {
        chunks.push(word.slice(offset, offset + maxChars));
      }
      return chunks;
    });
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

function distributeColumns(count: number, contentWidth: number, weights?: number[]) {
  if (count <= 0) return [];
  const usableWeights =
    weights?.length === count && weights.every((weight) => Number.isFinite(weight) && weight > 0)
      ? weights
      : Array.from({ length: count }, () => 1);
  const weightTotal = sum(usableWeights);
  return usableWeights.map((weight) => (contentWidth * weight) / weightTotal);
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
