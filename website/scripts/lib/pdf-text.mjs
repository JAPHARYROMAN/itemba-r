/**
 * Minimal PDF text extraction on top of pdf-lib, tuned for the Chromium/Skia
 * PDFs that scripts/generate-profile-pdfs.mjs produces (Type0/Identity-H fonts
 * with ToUnicode CMaps, one glyph per Tj with Td offsets between glyphs).
 *
 * Spaces and line breaks are inferred from glyph positions: a horizontal gap
 * wider than a fraction of the font size becomes a space, a vertical move
 * becomes a new line. Good enough to diff regenerated profiles and to assert
 * that key strings are present; not a general-purpose PDF text layer.
 */
import zlib from 'node:zlib';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
} from 'pdf-lib';

// ─── Affine matrices [a b c d e f] ───────────────────────────────────────────
const IDENTITY = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];
const translate = (tx, ty) => [1, 0, 0, 1, tx, ty];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// ─── Stream helpers ──────────────────────────────────────────────────────────
function decodeStream(stream) {
  const raw = Buffer.from(stream.getContents());
  const filter = stream.dict.get(PDFName.of('Filter'));
  const filters = filter instanceof PDFArray ? filter.asArray().map(String) : filter ? [String(filter)] : [];
  let data = raw;
  for (const f of filters) {
    if (f === '/FlateDecode') data = zlib.inflateSync(data);
    else return null; // unsupported filter for text purposes
  }
  return data;
}

// ─── Content stream tokenizer ────────────────────────────────────────────────
const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

function* tokenize(buf) {
  let i = 0;
  const n = buf.length;
  while (i < n) {
    const c = buf[i];
    if (WS.has(c)) {
      i++;
      continue;
    }
    if (c === 0x25) {
      // comment
      while (i < n && buf[i] !== 0x0a && buf[i] !== 0x0d) i++;
      continue;
    }
    if (c === 0x28) {
      // literal string
      let depth = 1;
      i++;
      const bytes = [];
      while (i < n && depth > 0) {
        const b = buf[i];
        if (b === 0x5c) {
          const e = buf[i + 1];
          const map = { 0x6e: 0x0a, 0x72: 0x0d, 0x74: 0x09, 0x62: 0x08, 0x66: 0x0c };
          if (map[e] !== undefined) {
            bytes.push(map[e]);
            i += 2;
          } else if (e >= 0x30 && e <= 0x37) {
            let oct = '';
            let j = i + 1;
            while (j < n && oct.length < 3 && buf[j] >= 0x30 && buf[j] <= 0x37) oct += String.fromCharCode(buf[j++]);
            bytes.push(parseInt(oct, 8) & 0xff);
            i = j;
          } else if (e === 0x0d || e === 0x0a) {
            i += e === 0x0d && buf[i + 2] === 0x0a ? 3 : 2;
          } else {
            bytes.push(e);
            i += 2;
          }
          continue;
        }
        if (b === 0x28) depth++;
        if (b === 0x29) {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        bytes.push(b);
        i++;
      }
      yield { t: 'str', v: Buffer.from(bytes) };
      continue;
    }
    if (c === 0x3c && buf[i + 1] === 0x3c) {
      yield { t: 'dictStart' };
      i += 2;
      continue;
    }
    if (c === 0x3e && buf[i + 1] === 0x3e) {
      yield { t: 'dictEnd' };
      i += 2;
      continue;
    }
    if (c === 0x3c) {
      let j = i + 1;
      let hex = '';
      while (j < n && buf[j] !== 0x3e) {
        if (!WS.has(buf[j])) hex += String.fromCharCode(buf[j]);
        j++;
      }
      if (hex.length % 2) hex += '0';
      yield { t: 'str', v: Buffer.from(hex, 'hex') };
      i = j + 1;
      continue;
    }
    if (c === 0x5b) {
      yield { t: 'arrStart' };
      i++;
      continue;
    }
    if (c === 0x5d) {
      yield { t: 'arrEnd' };
      i++;
      continue;
    }
    if (c === 0x2f) {
      let j = i + 1;
      while (j < n && !WS.has(buf[j]) && !DELIM.has(buf[j])) j++;
      yield { t: 'name', v: buf.toString('latin1', i + 1, j) };
      i = j;
      continue;
    }
    // number or operator
    let j = i;
    while (j < n && !WS.has(buf[j]) && !DELIM.has(buf[j])) j++;
    if (j === i) {
      i++; // stray delimiter such as '{' or '}'
      continue;
    }
    const word = buf.toString('latin1', i, j);
    i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      yield { t: 'num', v: parseFloat(word) };
      continue;
    }
    if (word === 'BI') {
      // Inline image: skip binary data up to whitespace + "EI".
      const end = buf.indexOf('EI', i, 'latin1');
      i = end === -1 ? n : end + 2;
      continue;
    }
    yield { t: 'op', v: word };
  }
}

// ─── Fonts ───────────────────────────────────────────────────────────────────
function parseCMap(text) {
  const map = new Map();
  const hexToCode = (h) => parseInt(h, 16);
  const hexToUnicode = (h) => {
    const bytes = Buffer.from(h.length % 4 ? h.padStart(Math.ceil(h.length / 4) * 4, '0') : h, 'hex');
    let s = '';
    for (let k = 0; k + 1 < bytes.length; k += 2) s += String.fromCharCode(bytes.readUInt16BE(k));
    return s;
  };
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, src, dst] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
      map.set(hexToCode(src), hexToUnicode(dst));
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const lo = hexToCode(m[1]);
      const hi = hexToCode(m[2]);
      if (m[3].startsWith('[')) {
        const items = [...m[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => hexToUnicode(x[1]));
        for (let code = lo; code <= hi; code++) map.set(code, items[code - lo] ?? '');
      } else {
        const base = m[3].slice(1, -1);
        const baseStr = hexToUnicode(base);
        const last = baseStr.charCodeAt(baseStr.length - 1);
        for (let code = lo; code <= hi; code++) {
          map.set(code, baseStr.slice(0, -1) + String.fromCharCode(last + (code - lo)));
        }
      }
    }
  }
  return map;
}

function numberOf(obj) {
  return obj instanceof PDFNumber ? obj.asNumber() : typeof obj?.asNumber === 'function' ? obj.asNumber() : 0;
}

function loadFont(context, fontDict) {
  const subtype = String(fontDict.get(PDFName.of('Subtype')));
  const twoByte = subtype === '/Type0';
  let toUnicode = new Map();
  const tu = fontDict.get(PDFName.of('ToUnicode'));
  const tuStream = tu instanceof PDFRef ? context.lookup(tu) : tu;
  if (tuStream instanceof PDFRawStream) {
    const data = decodeStream(tuStream);
    if (data) toUnicode = parseCMap(data.toString('latin1'));
  }
  const widths = new Map();
  let defaultWidth = 1000;
  if (twoByte) {
    const descendants = context.lookup(fontDict.get(PDFName.of('DescendantFonts')), PDFArray);
    const cid = context.lookup(descendants.get(0), PDFDict);
    const dw = cid.get(PDFName.of('DW'));
    if (dw) defaultWidth = numberOf(context.lookup(dw));
    const w = cid.get(PDFName.of('W'));
    const arr = w ? context.lookup(w, PDFArray).asArray().map((x) => context.lookup(x) ?? x) : [];
    for (let k = 0; k < arr.length; ) {
      const first = numberOf(arr[k]);
      const next = arr[k + 1];
      if (next instanceof PDFArray) {
        next.asArray().forEach((x, idx) => widths.set(first + idx, numberOf(context.lookup(x) ?? x)));
        k += 2;
      } else {
        const last = numberOf(next);
        const width = numberOf(arr[k + 2]);
        for (let code = first; code <= last; code++) widths.set(code, width);
        k += 3;
      }
    }
  } else {
    defaultWidth = 500;
    const firstChar = numberOf(context.lookup(fontDict.get(PDFName.of('FirstChar'))));
    const w = fontDict.get(PDFName.of('Widths'));
    if (w) {
      context
        .lookup(w, PDFArray)
        .asArray()
        .forEach((x, idx) => widths.set(firstChar + idx, numberOf(context.lookup(x) ?? x)));
    }
  }
  return {
    twoByte,
    decode(bytes) {
      const codes = [];
      if (twoByte) for (let k = 0; k + 1 < bytes.length; k += 2) codes.push(bytes.readUInt16BE(k));
      else for (const b of bytes) codes.push(b);
      return codes;
    },
    text(code) {
      if (toUnicode.has(code)) return toUnicode.get(code);
      return twoByte ? '' : String.fromCharCode(code);
    },
    width(code) {
      return widths.get(code) ?? defaultWidth;
    },
  };
}

// ─── Page walker ─────────────────────────────────────────────────────────────
function extractFromContent(doc, data, resources, baseCtm, glyphs, fontCache, depth = 0) {
  const context = doc.context;
  const fontsDict = resources?.lookupMaybe?.(PDFName.of('Font'), PDFDict);
  const xobjects = resources?.lookupMaybe?.(PDFName.of('XObject'), PDFDict);
  const getFont = (name) => {
    const ref = fontsDict?.get(PDFName.of(name));
    if (!ref) return null;
    const key = ref instanceof PDFRef ? ref.toString() : `${name}@${depth}`;
    if (!fontCache.has(key)) fontCache.set(key, loadFont(context, context.lookup(ref, PDFDict)));
    return fontCache.get(key);
  };

  let ctm = baseCtm;
  const stack = [];
  let tm = IDENTITY;
  let tlm = IDENTITY;
  let font = null;
  let fontSize = 0;
  let charSpacing = 0;
  let wordSpacing = 0;
  let hScale = 1;
  let leading = 0;
  let operands = [];
  const arrayStack = [];

  const show = (bytes) => {
    if (!font) return;
    for (const code of font.decode(bytes)) {
      const trm = mul(tm, ctm);
      const [x, y] = apply(trm, 0, 0);
      const size = fontSize * Math.sqrt(Math.abs(trm[0] * trm[3] - trm[1] * trm[2])) || fontSize;
      const w = (font.width(code) / 1000) * fontSize;
      const spacing = charSpacing + (!font.twoByte && code === 32 ? wordSpacing : 0);
      const tx = (w + spacing) * hScale;
      const [x2, y2] = apply(mul(translate(w * hScale, 0), trm), 0, 0);
      glyphs.push({ text: font.text(code), x, y, x2, y2, size });
      tm = mul(translate(tx, 0), tm);
    }
  };

  for (const tok of tokenize(data)) {
    if (tok.t === 'arrStart') {
      arrayStack.push(operands);
      operands = [];
      continue;
    }
    if (tok.t === 'arrEnd') {
      const arr = operands;
      operands = arrayStack.pop() ?? [];
      operands.push({ t: 'arr', v: arr });
      continue;
    }
    if (tok.t === 'dictStart' || tok.t === 'dictEnd') continue;
    if (tok.t !== 'op') {
      operands.push(tok);
      continue;
    }
    const nums = operands.filter((o) => o.t === 'num').map((o) => o.v);
    switch (tok.v) {
      case 'q':
        stack.push(ctm);
        break;
      case 'Q':
        ctm = stack.pop() ?? baseCtm;
        break;
      case 'cm':
        if (nums.length === 6) ctm = mul(nums, ctm);
        break;
      case 'BT':
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case 'Tf': {
        const name = operands.find((o) => o.t === 'name');
        font = name ? getFont(name.v) : null;
        fontSize = nums[0] ?? fontSize;
        break;
      }
      case 'Tc':
        charSpacing = nums[0] ?? 0;
        break;
      case 'Tw':
        wordSpacing = nums[0] ?? 0;
        break;
      case 'Tz':
        hScale = (nums[0] ?? 100) / 100;
        break;
      case 'TL':
        leading = nums[0] ?? 0;
        break;
      case 'Tm':
        if (nums.length === 6) {
          tm = nums.slice();
          tlm = nums.slice();
        }
        break;
      case 'Td':
      case 'TD':
        if (tok.v === 'TD') leading = -(nums[1] ?? 0);
        tlm = mul(translate(nums[0] ?? 0, nums[1] ?? 0), tlm);
        tm = tlm;
        break;
      case 'T*':
        tlm = mul(translate(0, -leading), tlm);
        tm = tlm;
        break;
      case 'Tj': {
        const s = operands.find((o) => o.t === 'str');
        if (s) show(s.v);
        break;
      }
      case "'":
      case '"': {
        tlm = mul(translate(0, -leading), tlm);
        tm = tlm;
        const s = operands.find((o) => o.t === 'str');
        if (s) show(s.v);
        break;
      }
      case 'TJ': {
        const arr = operands.find((o) => o.t === 'arr');
        for (const item of arr?.v ?? []) {
          if (item.t === 'str') show(item.v);
          else if (item.t === 'num') tm = mul(translate((-item.v / 1000) * fontSize * hScale, 0), tm);
        }
        break;
      }
      case 'Do': {
        const name = operands.find((o) => o.t === 'name');
        const ref = name && xobjects?.get(PDFName.of(name.v));
        const xobj = ref ? context.lookup(ref) : null;
        if (depth < 8 && xobj instanceof PDFRawStream && String(xobj.dict.get(PDFName.of('Subtype'))) === '/Form') {
          const matrix = xobj.dict.lookupMaybe(PDFName.of('Matrix'), PDFArray);
          const m = matrix ? matrix.asArray().map((x) => numberOf(context.lookup(x) ?? x)) : IDENTITY;
          const res = xobj.dict.lookupMaybe(PDFName.of('Resources'), PDFDict) ?? resources;
          const inner = decodeStream(xobj);
          if (inner) extractFromContent(doc, inner, res, mul(m, ctm), glyphs, fontCache, depth + 1);
        }
        break;
      }
      default:
        break;
    }
    operands = [];
  }
}

function glyphsToText(glyphs) {
  let out = '';
  let prev = null;
  for (const g of glyphs) {
    if (!g.text) continue;
    if (prev) {
      const size = Math.max(prev.size, g.size) || 1;
      const dy = Math.abs(g.y - prev.y);
      if (dy > size * 0.5) {
        out = out.replace(/[ \t]+$/, '');
        out += '\n';
      } else {
        const gap = g.x - prev.x2;
        if ((gap > size * 0.18 || gap < -size * 2) && !/\s$/.test(out) && !/^\s/.test(g.text)) out += ' ';
      }
    }
    out += g.text;
    prev = g;
  }
  return out
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * @param {Uint8Array} bytes PDF file contents
 * @returns {Promise<{pageCount:number, info:object, pages:{width:number,height:number,text:string}[]}>}
 */
export async function extractPdf(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const fontCache = new Map();
  const pages = doc.getPages().map((page) => {
    const glyphs = [];
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : contents ? [contents] : [];
    const resources = page.node.Resources();
    for (const s of streams) {
      if (!(s instanceof PDFRawStream)) continue;
      const data = decodeStream(s);
      if (data) extractFromContent(doc, data, resources, IDENTITY, glyphs, fontCache);
    }
    const { width, height } = page.getSize();
    return { width: Math.round(width * 100) / 100, height: Math.round(height * 100) / 100, text: glyphsToText(glyphs) };
  });
  const info = {
    title: doc.getTitle() ?? null,
    author: doc.getAuthor() ?? null,
    subject: doc.getSubject() ?? null,
    creator: doc.getCreator() ?? null,
    producer: doc.getProducer() ?? null,
    creationDate: doc.getCreationDate()?.toISOString() ?? null,
    modificationDate: doc.getModificationDate()?.toISOString() ?? null,
  };
  return { pageCount: doc.getPageCount(), info, pages };
}

/** Whitespace-insensitive, case-insensitive containment check. */
export function textIncludes(haystack, needle) {
  const squash = (s) => s.replace(/\s+/g, '').toLowerCase();
  return squash(haystack).includes(squash(needle));
}

// Keep tree-shaking honest for unused imports in some bundlers.
void PDFHexString;
void PDFString;
