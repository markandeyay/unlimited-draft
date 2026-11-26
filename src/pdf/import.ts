// PDF script import. Text items are grouped into lines and classified by their left indent.
import { SCENE_START } from '../editor/flow';
import type { ElementType } from '../layout/geometry';
import type { PlainLine } from '../import/fountain';

export interface PdfTextLine { x: number; y: number; right: number; text: string }
export interface PdfPage { width: number; height: number; lines: PdfTextLine[] }

interface PdfJsLike { getDocument: (src: any) => { promise: Promise<any> } }

/** Read text lines with positions from a PDF using pdf.js (passed in so tests can use the Node build). */
export async function extractPdfPages(data: Uint8Array, pdfjs: PdfJsLike): Promise<PdfPage[]> {
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  const pages: PdfPage[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const rows = new Map<number, { x: number; w: number; str: string }[]>();
    for (const it of tc.items as any[]) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] * 2) / 2;
      let key = y;
      for (const k of rows.keys()) if (Math.abs(k - y) <= 2) { key = k; break; }
      const arr = rows.get(key) ?? [];
      arr.push({ x: it.transform[4], w: it.width ?? it.str.length * 7.2, str: it.str });
      rows.set(key, arr);
    }
    const lines: PdfTextLine[] = [];
    for (const [y, items] of rows) {
      items.sort((a, b) => a.x - b.x);
      let text = '';
      let end = items[0].x;
      for (const it of items) {
        const gap = it.x - end;
        if (text && gap > 2.5) text += ' '.repeat(Math.max(1, Math.round(gap / 7.2)));
        text += it.str;
        end = it.x + it.w;
      }
      lines.push({ x: items[0].x + (items[0].str.length - items[0].str.trimStart().length) * 7.2, y, right: end, text: text.replace(/\u00a0/g, ' ').trim() });
    }
    lines.sort((a, b) => b.y - a.y);
    pages.push({ width: vp.width, height: vp.height, lines });
  }
  return pages;
}

const isUpper = (t: string) => t === t.toUpperCase() && /[A-Z]/.test(t);

/** Turn positioned lines into screenplay elements. */
export function classifyPdf(pages: PdfPage[]): { title?: string; lines: PlainLine[] } {
  if (!pages.length) return { lines: [] };
  // The action indent is the most common left edge.
  const counts = new Map<number, number>();
  for (const p of pages) for (const l of p.lines) { const k = Math.round(l.x / 3) * 3; counts.set(k, (counts.get(k) ?? 0) + 1); }
  let base = 108, best = 0;
  for (const [k, c] of counts) if (c > best || (c === best && k < base)) { best = c; base = k; }
  for (const k of counts.keys()) if (k < base && k > base - 12 && (counts.get(k) ?? 0) > best * 0.5) base = k;

  let title: string | undefined;
  let body = pages;
  const first = pages[0];
  const firstLooksLikeTitle = pages.length > 1 && first.lines.length <= 14
    && !first.lines.some((l) => Math.abs(l.x - base) < 8 && SCENE_START.test(l.text));
  if (firstLooksLikeTitle) {
    title = first.lines[0]?.text;
    body = pages.slice(1);
  }

  const out: PlainLine[] = [];
  let prev: { type: ElementType; y: number; page: number; dual?: string } | null = null;
  body.forEach((page, pi) => {
    const h = page.height;
    for (const l of page.lines) {
      const t = l.text;
      const fromTop = h - l.y;
      if (fromTop < 62 && /^\d+[A-Z]?\.?$/.test(t)) continue; // page number
      if (fromTop > h - 50 && /^\d+[A-Z]?\.?$/.test(t)) continue; // bottom page number
      if (/^\(MORE\)$/i.test(t) || /^\(CONTINUED\)$/i.test(t) || /^CONTINUED:?(\s*\(\d+\))?$/i.test(t)) continue;
      const dx = l.x - base;
      let type: ElementType;
      const rightAligned = l.right > base + 395 && dx > 150;
      if (dx < 20) {
        const stripped = t.replace(/^\d+[A-Z]?\s+/, '').replace(/\s+\d+[A-Z]?$/, '');
        if (SCENE_START.test(stripped)) type = 'scene';
        else type = 'action';
        if (type === 'scene') { out.push({ type, text: stripped }); prev = { type, y: l.y, page: pi }; continue; }
      } else if (rightAligned && isUpper(t)) type = 'transition';
      else if (dx < 95 && !t.startsWith('(')) type = 'dialogue';
      else if (dx < 130 && /^\(/.test(t)) type = 'parenthetical';
      else if (dx < 130) type = prev?.type === 'parenthetical' && !/\)$/.test(out[out.length - 1]?.text ?? ')') ? 'parenthetical' : 'dialogue';
      else if (dx < 215) type = isUpper(t.replace(/\(.*?\)/g, '')) ? 'character' : 'dialogue';
      else type = isUpper(t) ? 'transition' : 'action';

      let text = t;
      if (type === 'character') {
        // "NAME (CONT'D)" printed at the top of a page for split dialogue repeats the speaker: skip it.
        const wasContd = /\(CONT['’]D\)\s*$/i.test(text);
        text = text.replace(/\s*\(CONT['’]D\)\s*$/i, '').trim();
        const lastChar = [...out].reverse().find((x) => x.type === 'character');
        const firstOnPage = !prev || prev.page !== pi;
        if (wasContd && firstOnPage && lastChar && lastChar.text === text && ['dialogue', 'parenthetical'].includes(out[out.length - 1]?.type)) {
          prev = { type: 'dialogue', y: l.y + 12, page: pi };
          continue;
        }
      }
      const gap = prev && prev.page === pi ? prev.y - l.y : 99;
      const last = out[out.length - 1];
      const joinable = type === 'action' || type === 'dialogue' || type === 'parenthetical';
      const pageJoin = prev && prev.page !== pi && last && last.type === type && joinable && !/[.?!:"”)]$/.test(last.text) && type !== 'parenthetical';
      if (last && joinable && last.type === type && ((gap > 0 && gap < 16) || pageJoin)) {
        last.text += ` ${text}`;
      } else {
        out.push({ type, text });
      }
      prev = { type, y: l.y, page: pi };
    }
  });
  return { title, lines: out };
}
