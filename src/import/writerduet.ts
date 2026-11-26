// WriterDuet project files and the general "any script file" entry point.
// See docs/DECISIONS.md for what WriterDuet's own export format looks like and which path is used.
import { strFromU8, unzipSync } from 'fflate';
import type { ElementType } from '../layout/geometry';
import { parseFdx } from './fdx';
import { type PlainLine, parseFountain } from './fountain';

export interface Imported { title?: string; author?: string; lines: PlainLine[]; format: string }

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

function fromJson(text: string): Imported | null {
  try {
    const j = JSON.parse(text);
    // Our own document format.
    if (j && j.schema === 1 && Array.isArray(j.lines)) return { title: j.name, lines: j.lines.map((l: any) => ({ type: l.type, text: l.text, dual: l.dual })), format: 'Unlimited Draft JSON' };
    const lines = findLines(j);
    if (lines?.length) return { title: typeof j.title === 'string' ? j.title : typeof j.name === 'string' ? j.name : undefined, lines, format: 'WriterDuet JSON' };
  } catch { /* not JSON */ }
  return null;
}

/** Parse the text of a script file by sniffing its format. */
export function importText(text: string, fileName = ''): Imported {
  const t = text.replace(/^﻿/, '');
  if (/<FinalDraft\b/i.test(t) || /\.fdx$/i.test(fileName)) { const r = parseFdx(t); return { ...r, format: 'Final Draft (FDX)' }; }
  if (/^\s*[{[]/.test(t)) { const r = fromJson(t); if (r) return r; }
  const r = parseFountain(t);
  return { ...r, format: 'Fountain' };
}

/** Import a file's bytes: zip archives (WriterDuet .wdz backups) are searched for a script inside. */
export function importBytes(bytes: Uint8Array, fileName: string): Imported {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip) {
    const files = unzipSync(bytes);
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
