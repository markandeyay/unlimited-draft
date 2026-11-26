// PDF export. Draws the layout engine's rows at exact positions with embedded Courier Prime.
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, type PDFFont, type PDFPage, rgb } from 'pdf-lib';
import type { ElementType, PageGeometry } from '../layout/geometry';
import { type LayoutLine, type LayoutOptions, type LayoutResult, type Row, createLayoutEngine } from '../layout/paginate';
import { computeSceneNumbers } from '../layout/sceneNumbers';
import { layoutOptionsFor } from '../settings/settings';
import type { Comment, DocumentFile, InlineMark, Line, Settings } from '../storage/models';
import type { PdfOptions } from './util';

export type { PdfOptions } from './util';

export interface FontBytes { regular: ArrayBuffer | Uint8Array; bold: ArrayBuffer | Uint8Array; italic: ArrayBuffer | Uint8Array; boldItalic: ArrayBuffer | Uint8Array }

let fontLoader: () => Promise<FontBytes> = async () => {
  const get = async (n: string) => (await fetch(`/fonts/CourierPrime-${n}.ttf`)).arrayBuffer();
  const [regular, bold, italic, boldItalic] = await Promise.all([get('Regular'), get('Bold'), get('Italic'), get('BoldItalic')]);
  return { regular, bold, italic, boldItalic };
};
let fontCache: Promise<FontBytes> | null = null;
export function setFontLoader(fn: () => Promise<FontBytes>) { fontLoader = fn; fontCache = null; }
const fonts = () => (fontCache ??= fontLoader());

export function toLayoutLines(doc: DocumentFile, withSceneNumbers: boolean, onlyIds?: Set<string>): LayoutLine[] {
  const sn = withSceneNumbers
    ? computeSceneNumbers(doc.lines, { locked: doc.sceneNumbers.locked, start: doc.settings.sceneNumberStart })
    : null;
  const out: LayoutLine[] = [];
  for (const l of doc.lines) {
    if (onlyIds && !onlyIds.has(l.id)) continue;
    out.push({
      id: l.id, type: l.type, text: l.text, dual: l.dual, pageBreakBefore: l.pageBreakBefore, omitted: l.omitted,
      align: l.align, revisionMarked: l.revisionMarked, sceneNumber: sn?.get(l.id),
    });
  }
  return out;
}

/** Layout used for print: notes, outline and sequence lines are hidden unless asked for. */
export function layoutForPrint(doc: DocumentFile, s: Settings, o: PdfOptions): { result: LayoutResult; options: Partial<LayoutOptions> } {
  const hide = new Set<ElementType>(['outline', 'sequence']);
  if (!o.includeNotes) hide.add('note');
  if (o.hideShots) hide.add('shot');
  const options = { ...layoutOptionsFor(s, doc), hide };
  const result = createLayoutEngine().layout(toLayoutLines(doc, o.sceneNumbers, o.onlyIds), options);
  return { result, options };
}

function expandTokens(t: string, ctx: { page: number; title: string; draft: string }): string {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return t.replace(/\{page\}/gi, String(ctx.page)).replace(/\{title\}/gi, ctx.title).replace(/\{date\}/gi, date)
    .replace(/\{draft\}/gi, ctx.draft).replace(/\{revision\}/gi, ctx.draft);
}

const hex = (c: string) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  return m ? rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255) : rgb(0, 0, 0);
};

interface Fonts { regular: PDFFont; bold: PDFFont; italic: PDFFont; boldItalic: PDFFont }

function clean(font: PDFFont, text: string): string {
  let out = '';
  const set = font.getCharacterSet();
  for (const ch of text.replace(/\u00a0/g, ' ')) out += set.includes(ch.codePointAt(0)!) ? ch : '?';
  return out;
}

class Painter {
  constructor(private g: PageGeometry, private f: Fonts) {}

  y(row: number) { return this.g.heightPt - (this.g.topPt + row * this.g.linePt + this.g.baselinePt); }
  x(col: number) { return col * this.g.charPt; }

  text(page: PDFPage, col: number, row: number, text: string, style: { bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; color?: string; highlight?: string; gray?: number } = {}) {
    if (!text) return;
    const font = style.bold ? (style.italic ? this.f.boldItalic : this.f.bold) : style.italic ? this.f.italic : this.f.regular;
    const x = this.x(col), y = this.y(row), w = text.length * this.g.charPt;
    if (style.highlight) page.drawRectangle({ x, y: y - 2.5, width: w, height: this.g.linePt, color: hex(style.highlight) });
    const color = style.color ? hex(style.color) : style.gray !== undefined ? rgb(style.gray, style.gray, style.gray) : rgb(0, 0, 0);
    page.drawText(clean(font, text), { x, y, size: 12, font, color });
    if (style.underline) page.drawLine({ start: { x, y: y - 1.6 }, end: { x: x + w, y: y - 1.6 }, thickness: 0.7, color });
    if (style.strike) page.drawLine({ start: { x, y: y + 3 }, end: { x: x + w, y: y + 3 }, thickness: 0.7, color });
  }

  /** Draw a row, splitting it into runs where inline marks change. */
  row(page: PDFPage, r: Row, marks: InlineMark[] | undefined, extra: { gray?: number; highlight?: string } = {}) {
    const base = { bold: r.bold, italic: r.italic, underline: r.underline, ...extra };
    if (!marks?.length || r.kind !== 'text') { this.text(page, r.col, r.row, r.text, base); return; }
    const cuts = new Set<number>([r.start, r.end]);
    for (const m of marks) { if (m.from > r.start && m.from < r.end) cuts.add(m.from); if (m.to > r.start && m.to < r.end) cuts.add(m.to); }
    const pts = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < pts.length - 1; i++) {
      const from = pts[i], to = pts[i + 1];
      const active = marks.filter((m) => m.from <= from && m.to >= to);
      const st: any = { ...base };
      for (const m of active) {
        if (m.kind === 'bold') st.bold = true;
        else if (m.kind === 'italic') st.italic = true;
        else if (m.kind === 'underline') st.underline = true;
        else if (m.kind === 'strike') st.strike = true;
        else if (m.kind === 'color') st.color = m.value;
        else if (m.kind === 'highlight') st.highlight = m.value;
      }
      this.text(page, r.col + (from - r.start), r.row, r.text.slice(from - r.start, to - r.start), st);
    }
    // Text appended by the engine (for example an automatic CONT'D) after the source text.
    const tail = r.text.slice(r.end - r.start);
    if (tail) this.text(page, r.col + (r.end - r.start), r.row, tail, base);
  }
}

export interface BuildInput {
  title: string;
  script: DocumentFile;
  titlePage?: DocumentFile;
  settings: Settings;
  options: PdfOptions;
  images?: Map<string, { bytes: Uint8Array; type: string }>;
}

export async function buildPdf(input: BuildInput): Promise<Uint8Array> {
  const { script, settings: s, options: o, title } = input;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fb = await fonts();
  const f: Fonts = {
    regular: await pdf.embedFont(fb.regular, { subset: true }),
    bold: await pdf.embedFont(fb.bold, { subset: true }),
    italic: await pdf.embedFont(fb.italic, { subset: true }),
    boldItalic: await pdf.embedFont(fb.boldItalic, { subset: true }),
  };
  pdf.setTitle(title);
  pdf.setAuthor(s.pdf.authorName);
  pdf.setCreator('Unlimited Draft');

  const { result, options } = layoutForPrint(script, s, o);
  const g = options.geometry!;
  const paint = new Painter(g, f);
  const byId = new Map<string, Line>(script.lines.map((l) => [l.id, l]));
  const side = script.settings.sceneNumberSide ?? s.pdf.sceneNumbers;

  if (o.includeTitlePage && input.titlePage && !o.onlyIds) {
    const tp = input.titlePage;
    const tl = createLayoutEngine().layout(toLayoutLines(tp, false), { ...layoutOptionsFor(s, tp), autoContd: false });
    const page = pdf.addPage([g.widthPt, g.heightPt]);
    const tById = new Map(tp.lines.map((l) => [l.id, l]));
    for (const r of tl.pages[0].rows) if (r.kind === 'text') paint.row(page, r, tById.get(r.lineId)?.marks);
  }

  const commentsByLine = new Map<string, Comment[]>();
  if (o.includeNotes) for (const c of o.comments ?? []) {
    if (c.resolved) continue;
    const arr = commentsByLine.get(c.lineId) ?? [];
    arr.push(c);
    commentsByLine.set(c.lineId, arr);
  }
  const printedComments: { n: number; page: number; c: Comment }[] = [];

  const from = Math.max(1, o.pageFrom ?? 1);
  const to = Math.min(result.pages.length, o.pageTo ?? result.pages.length);
  for (let pi = from - 1; pi < to; pi++) {
    const lp = result.pages[pi];
    const page = pdf.addPage([g.widthPt, g.heightPt]);
    const num = pi + 1;
    const ctx = { page: num, title, draft: s.pdf.draftName };

    // Page number.
    const pos = s.page.pageNumberPosition;
    if (pos !== 'none' && (num > 1 || g.pageNumberFirstPage)) {
      const label = `${num}.`;
      if (pos === 'top-right') paint.text(page, g.pageNumberCol, g.pageNumberRow, label);
      else if (pos === 'top-left') paint.text(page, g.elements.action.left, g.pageNumberRow, label);
      else if (pos === 'bottom-right') paint.text(page, g.pageNumberCol, g.linesPerPage + 2, label);
      else paint.text(page, (g.widthPt / g.charPt - label.length) / 2, g.linesPerPage + 2, label);
    }
    // Headers and footers.
    const hf = (v: { left: string; center: string; right: string }, row: number) => {
      const left = g.elements.action.left, right = g.pageNumberCol;
      if (v.left) paint.text(page, left, row, expandTokens(v.left, ctx));
      if (v.center) { const t = expandTokens(v.center, ctx); paint.text(page, (g.widthPt / g.charPt - t.length) / 2, row, t); }
      if (v.right) { const t = expandTokens(v.right, ctx); paint.text(page, right - t.length - (pos === 'top-right' && row < 0 ? 6 : 0), row, t); }
    };
    hf(script.settings.header, g.pageNumberRow);
    hf(script.settings.footer, g.linesPerPage + 2);
    if (o.heading && pi === from - 1) paint.text(page, g.elements.action.left, -2, o.heading, { gray: 0.45 });

    for (const r of lp.rows) {
      if (r.kind === 'image') {
        const line = byId.get(r.lineId);
        const img = line?.imageRef ? input.images?.get(line.imageRef) : undefined;
        if (img) {
          try {
            const emb = /png/i.test(img.type) ? await pdf.embedPng(img.bytes) : await pdf.embedJpg(img.bytes);
            const boxH = (r.rows ?? 10) * g.linePt, boxW = g.elements.image.width * g.charPt;
            const sc = Math.min(boxW / emb.width, boxH / emb.height);
            const top = g.heightPt - (g.topPt + r.row * g.linePt);
            page.drawImage(emb, { x: paint.x(r.col), y: top - emb.height * sc, width: emb.width * sc, height: emb.height * sc });
          } catch { /* unsupported image: leave the space blank */ }
        }
        continue;
      }
      const line = byId.get(r.lineId);
      const isNote = r.type === 'note';
      paint.row(page, r, r.kind === 'text' ? line?.marks : undefined, isNote ? { gray: 0.35, highlight: '#fbf6cf' } : {});
      if (r.kind !== 'text') continue;
      if (r.sceneNumber && o.sceneNumbers) {
        if (side !== 'right') paint.text(page, g.sceneNumberLeftCol, r.row, r.sceneNumber);
        if (side !== 'left') paint.text(page, g.sceneNumberRightCol, r.row, r.sceneNumber);
      }
      if (r.revisionMarked && o.revisionAsterisks) paint.text(page, 77.5, r.row, '*');
      const cs = r.start === 0 ? commentsByLine.get(r.lineId) : undefined;
      if (cs) for (const c of cs) {
        const n = printedComments.length + 1;
        printedComments.push({ n, page: num, c });
        page.drawText(`[${n}]`, { x: paint.x(79), y: paint.y(r.row), size: 8, font: f.regular, color: rgb(0.75, 0.3, 0) });
      }
    }
  }

  if (printedComments.length) {
    let page = pdf.addPage([g.widthPt, g.heightPt]);
    let row = 0;
    paint.text(page, g.elements.action.left, row, 'COMMENTS', { bold: true });
    row += 2;
    const eng = createLayoutEngine();
    for (const pc of printedComments) {
      const text = `[${pc.n}] p.${pc.page}${pc.c.quote ? ` "${pc.c.quote}"` : ''}: ${pc.c.text}`;
      const rows = eng.layout([{ id: 'c', type: 'action', text }], { geometry: g }).pages[0].rows;
      if (row + rows.length > g.linesPerPage) { page = pdf.addPage([g.widthPt, g.heightPt]); row = 0; }
      for (const r of rows) { paint.text(page, r.col, row, r.text); row++; }
      row++;
    }
  }
  return pdf.save();
}


/** Simple text report as a PDF (statistics, locations, shots). One string per row; long rows wrap. */
export async function buildReportPdf(title: string, rows: string[], g: PageGeometry): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fb = await fonts();
  const f: Fonts = {
    regular: await pdf.embedFont(fb.regular, { subset: true }),
    bold: await pdf.embedFont(fb.bold, { subset: true }),
    italic: await pdf.embedFont(fb.italic, { subset: true }),
    boldItalic: await pdf.embedFont(fb.boldItalic, { subset: true }),
  };
  pdf.setTitle(title);
  const paint = new Painter(g, f);
  const lines: LayoutLine[] = [{ id: 'h', type: 'text', text: title.toUpperCase() }, { id: 'b', type: 'text', text: '' },
    ...rows.map((text, i): LayoutLine => ({ id: `r${i}`, type: 'text', text }))];
  const res = createLayoutEngine().layout(lines, { geometry: g, autoContd: false });
  res.pages.forEach((lp, pi) => {
    const page = pdf.addPage([g.widthPt, g.heightPt]);
    if (pi > 0) paint.text(page, g.pageNumberCol, g.pageNumberRow, `${pi + 1}.`);
    for (const r of lp.rows) if (r.kind === 'text') paint.text(page, r.col, r.row, r.text, { bold: r.lineId === 'h' });
  });
  return pdf.save();
}
