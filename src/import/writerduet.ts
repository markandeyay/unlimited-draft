// WriterDuet project files and the general "any script file" entry point.
// See docs/DECISIONS.md for what WriterDuet's own export format looks like and which path is used.
import { strFromU8, unzipSync } from 'fflate';
import type { ElementType } from '../layout/geometry';
import { parseFdx } from './fdx';
import { type PlainLine, type PlainMark, parseFountain } from './fountain';

export interface Imported {
  title?: string; author?: string; lines: PlainLine[]; format: string; warning?: string;
  /** Title page lines, when the file carries them. */
  titlePage?: PlainLine[];
  /** Index of the first line of each page as the source app paginated it (for checking). */
  pageStarts?: number[];
}

const WD_TYPES: Record<string, ElementType> = {
  slugline: 'scene', scene: 'scene', 'scene heading': 'scene',
  action: 'action',
  editdialogname: 'character', character: 'character',
  editdialogcontent: 'dialogue', dialogue: 'dialogue', dialog: 'dialogue',
  editdialogparen: 'parenthetical', parenthetical: 'parenthetical', parens: 'parenthetical',
  transition: 'transition', shot: 'shot', text: 'text', note: 'note', outline: 'outline', sequence: 'sequence',
  act: 'newAct', 'new act': 'newAct', endact: 'endAct', 'end act': 'endAct', lyrics: 'lyrics', lyric: 'lyrics', image: 'image',
};

const stripTags = (s: string) => s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Look for an array of line-like objects anywhere in a JSON value. */
function findLines(v: unknown, depth = 0): PlainLine[] | null {
  if (!v || depth > 6) return null;
  const toLine = (o: any): PlainLine | null => {
    if (!o || typeof o !== 'object') return null;
    const rawType = o.type ?? o.lineType ?? o.class ?? o.kind ?? o.element;
    const rawText = o.text ?? o.content ?? o.html ?? o.value;
    if (typeof rawType !== 'string' || typeof rawText !== 'string') return null;
    const t = WD_TYPES[rawType.replace(/^screeny-/i, '').toLowerCase()];
    if (!t) return null;
    const line: PlainLine = { type: t, text: stripTags(rawText).trim() };
    if (o.dual === 'left' || o.dual === 'right') line.dual = o.dual;
    return line;
  };
  if (Array.isArray(v)) {
    const lines = v.map(toLine);
    const ok = lines.filter(Boolean) as PlainLine[];
    if (ok.length >= Math.max(1, v.length * 0.6) && v.length > 0) return ok;
    for (const x of v) { const r = findLines(x, depth + 1); if (r) return r; }
    return null;
  }
  if (typeof v === 'object') {
    const vals = Object.values(v as Record<string, unknown>);
    // Maps of id -> line (Firebase style) keep insertion order.
    const asLines = vals.map(toLine);
    const ok = asLines.filter(Boolean) as PlainLine[];
    if (vals.length > 2 && ok.length >= vals.length * 0.6) return ok;
    for (const x of vals) { const r = findLines(x, depth + 1); if (r) return r; }
  }
  return null;
}

const WD_ATTRS: Record<string, PlainMark['kind']> = { b: 'bold', i: 'italic', u: 'underline', s: 'strike' };

function wdJsonLine(o: any, titlePage: boolean): PlainLine {
  const rawType = String(o.type ?? 'Action').toLowerCase();
  const type: ElementType = titlePage ? (rawType === 'note' ? 'note' : 'text') : WD_TYPES[rawType] ?? 'action';
  const line: PlainLine = { type, text: String(o.text ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+$/, '') };
  const marks: PlainMark[] = [];
  for (const [k, ranges] of Object.entries(o.attributes?.textAttributes ?? {})) {
    const kind = WD_ATTRS[k];
    if (!kind || !Array.isArray(ranges)) continue;
    for (const r of ranges as any[]) {
      const from = Math.max(0, Number(r.start) || 0), to = Math.min(line.text.length, Number(r.end) || 0);
      if (to > from) marks.push({ from, to, kind });
    }
  }
  if (marks.length) line.marks = marks;
  // On the title page, Title and Author lines are centered by their type.
  const align = o.alignment ?? (titlePage && (rawType === 'title' || rawType === 'author') ? 'center' : undefined);
  if (align === 'center' || align === 'right') line.align = align;
  return line;
}

/** WriterDuet's JSON export: { lines: [{ type, text, attributes, alignment, pageNumber }], titlePage: { lines } }. */
function fromWriterDuetJson(j: any): Imported | null {
  if (!j || !Array.isArray(j.lines) || !j.lines.length || typeof j.lines[0]?.text !== 'string' || !('wdId' in j.lines[0])) return null;
  const lines = (j.lines as any[]).map((o) => wdJsonLine(o, false));
  const pageStarts = (j.lines as any[]).map((o, i) => (o.pageNumber ? i : -1)).filter((i) => i >= 0);
  const tp = Array.isArray(j.titlePage?.lines) ? (j.titlePage.lines as any[]) : null;
  const titlePage = tp?.map((o) => wdJsonLine(o, true));
  const title = tp?.find((o) => String(o.type).toLowerCase() === 'title')?.text?.trim();
  const author = tp?.find((o) => String(o.type).toLowerCase() === 'author')?.text?.trim();
  return { title: title || undefined, author: author || undefined, lines, titlePage, pageStarts, format: 'WriterDuet (JSON)' };
}

function fromJson(text: string): Imported | null {
  try {
    const j = JSON.parse(text);
    const wd = fromWriterDuetJson(j);
    if (wd) return wd;
    // Our own document format.
    if (j && j.schema === 1 && Array.isArray(j.lines)) return { title: j.name, lines: j.lines.map((l: any) => ({ type: l.type, text: l.text, dual: l.dual })), format: 'Unlimited Draft JSON' };
    const lines = findLines(j);
    if (lines?.length) return { title: typeof j.title === 'string' ? j.title : typeof j.name === 'string' ? j.name : undefined, lines, format: 'WriterDuet JSON' };
  } catch { /* not JSON */ }
  return null;
}

/** Parse the text of a script file by sniffing its format. */
export function importText(text: string, fileName = ''): Imported {
  const t = text.replace(/^\uFEFF/, '');
  if (/<FinalDraft\b/i.test(t) || /\.fdx$/i.test(fileName)) { const r = parseFdx(t); return { ...r, format: 'Final Draft (FDX)' }; }
  if (/^\s*[{[]/.test(t)) { const r = fromJson(t); if (r) return r; }
  const r = parseFountain(t);
  return { ...r, format: 'Fountain' };
}

// WriterDuet marks inline formatting with control characters: a start code and the next code as its end.
const WD_CODES: Record<number, 'bold' | 'italic' | 'underline'> = { 1: 'bold', 3: 'italic', 5: 'underline' };

function wdText(raw: string): { text: string; marks: PlainMark[] }[] {
  // A line feed inside a WriterDuet line is a soft break: it becomes a new line directly below.
  return raw.split('\n').map((part) => {
    let text = '';
    const marks: PlainMark[] = [];
    const open: Partial<Record<string, number>> = {};
    for (const ch of part) {
      const c = ch.charCodeAt(0);
      if (c < 32) {
        const start = WD_CODES[c];
        const end = WD_CODES[c - 1];
        if (start) open[start] = text.length;
        else if (end && open[end] !== undefined) {
          if (text.length > open[end]!) marks.push({ from: open[end]!, to: text.length, kind: end });
          delete open[end];
        }
        continue;
      }
      text += ch;
    }
    return { text, marks };
  });
}

/**
 * WriterDuet's own export (.wdz): a zip with script.json (project info and edit log) and one checkpoint
 * file per document. A checkpoint holds every line as { type, cache: { t: text } } keyed by a sortable id.
 */
export function parseWdz(files: Record<string, Uint8Array>): Imported | null {
  if (!files['script.json']) return null;
  const info = JSON.parse(strFromU8(files['script.json']));
  const title: string | undefined = info?.script_info?.script_title || info?.script_info?.project_name;
  const author: string | undefined = info?.script_info?.script_author;
  let best: { data: Record<string, any>; custom: Record<string, any> } | null = null;
  for (const [name, bytes] of Object.entries(files)) {
    if (name === 'script.json') continue;
    try {
      const j = JSON.parse(strFromU8(bytes));
      const data = j?.checkpoint?.data;
      if (data && (!best || Object.keys(data).length > Object.keys(best.data).length)) {
        best = { data, custom: j.checkpoint?.formatting?.custom_line_types?.list ?? {} };
      }
    } catch { /* not a checkpoint */ }
  }
  if (!best) return null;
  const lines: PlainLine[] = [];
  const keys = Object.keys(best.data).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const k of keys) {
    const row = best.data[k];
    const raw: string = row?.cache?.t ?? '';
    let typeName = String(row?.type ?? 'Action');
    if (best.custom[typeName]?.name) typeName = best.custom[typeName].name;
    const type = WD_TYPES[typeName.toLowerCase()] ?? 'action';
    const parts = wdText(raw);
    parts.forEach((part, i) => {
      const t: ElementType = i === 0 ? type : type === 'action' || type === 'scene' || type === 'shot' ? 'text' : type;
      const line: PlainLine = { type: t, text: part.text.replace(/\s+$/, '') };
      if (part.marks.length) line.marks = part.marks.filter((m) => m.from < line.text.length).map((m) => ({ ...m, to: Math.min(m.to, line.text.length) }));
      if (row?.dual === 'left' || row?.dual === 'right') line.dual = row.dual;
      lines.push(line);
    });
  }
  // Edits made after the last checkpoint live in the edit log and are not replayed here.
  const main = info?.b?.['-']?.h ?? {};
  const pending = Object.values(main).filter((op: any) => typeof op?.l === 'string' && op.l.startsWith('data/')).length;
  return {
    title, author, lines, format: 'WriterDuet (.wdz)',
    warning: pending ? `${pending} recent edits were made after WriterDuet's last checkpoint and may be missing. Compare with a PDF export.` : undefined,
  };
}

/** Import a file's bytes: zip archives (WriterDuet .wdz backups) are searched for a script inside. */
export function importBytes(bytes: Uint8Array, fileName: string): Imported {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip) {
    const files = unzipSync(bytes);
    const wd = parseWdz(files);
    if (wd?.lines.length) return wd;
    const names = Object.keys(files);
    const pick = (re: RegExp) => names.find((n) => re.test(n));
    const order = [pick(/\.fdx$/i), pick(/\.fountain$/i), pick(/\.json$/i), pick(/\.(txt|wd)$/i), names[0]].filter(Boolean) as string[];
    for (const n of order) {
      const r = importText(strFromU8(files[n]), n);
      if (r.lines.length) return { ...r, format: `WriterDuet archive (${r.format})` };
    }
    return { lines: [], format: 'Unknown archive' };
  }
  return importText(new TextDecoder().decode(bytes), fileName);
}
