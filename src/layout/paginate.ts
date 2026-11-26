// Pagination engine. Pure TypeScript: no DOM, no React.
// Input: the document's lines in order. Output: pages of positioned rows (for the PDF)
// and per-line placement info (for the editor's decorations).

import { type Align, type ElementSpec, type ElementType, type PageGeometry, LETTER } from './geometry';
import { type Segment, endsSentence, wrapText } from './wrap';

export interface LayoutLine {
  id: string;
  type: ElementType;
  text: string;
  dual?: 'left' | 'right';
  pageBreakBefore?: boolean;
  sceneNumber?: string;
  omitted?: boolean;
  align?: Align;
  revisionMarked?: boolean;
  /** Height of an image line in rows. */
  imageRows?: number;
}

export interface LayoutOptions {
  geometry: PageGeometry;
  /** Element types left out entirely (for example notes in a normal PDF). */
  hide: ReadonlySet<ElementType>;
  autoContd: boolean;
  moreText: string;
  contdText: string;
  splitDialogue: boolean;
  splitAction: boolean;
  splitAtSentences: boolean;
  sceneContinueds: boolean;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  geometry: LETTER,
  hide: new Set(),
  autoContd: true,
  moreText: '(MORE)',
  contdText: "(CONT'D)",
  splitDialogue: true,
  splitAction: true,
  splitAtSentences: true,
  sceneContinueds: false,
};

export type RowKind = 'text' | 'more' | 'contd' | 'continuedTop' | 'continuedBottom' | 'image';

export interface Row {
  lineId: string;
  type: ElementType;
  kind: RowKind;
  /** Line index on the page. 0 is the first body line. Negative and >= linesPerPage are margin rows. */
  row: number;
  /** Left edge in characters from the paper's left edge. May be fractional for centered text. */
  col: number;
  text: string;
  /** Offsets into the line's source text for this row (text rows only). */
  start: number;
  end: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  sceneNumber?: string;
  revisionMarked?: boolean;
  rows?: number;
}

export interface PageOut {
  index: number;
  rows: Row[];
  usedRows: number;
}

export interface BreakInfo {
  /** Index of the page that starts here. */
  page: number;
  /** Unused body rows at the bottom of the previous page. */
  filler: number;
  more: boolean;
  /** "NAME (CONT'D)" printed above the first row of the new page. */
  contdName?: string;
  manual: boolean;
}

export interface SplitInfo extends BreakInfo {
  /** Source text offset where the new page starts. */
  offset: number;
}

export interface LineInfo {
  page: number;
  row: number;
  rows: number;
  spaceBefore: number;
  /** Source offsets where a new visual row starts (excluding 0). */
  wraps: number[];
  /** Character line that gets an automatic (CONT'D). */
  contd: boolean;
  breakBefore?: BreakInfo;
  splits: SplitInfo[];
}

export interface LayoutResult {
  pages: PageOut[];
  info: Map<string, LineInfo>;
}

interface Wrapped {
  line: LayoutLine;
  spec: ElementSpec;
  display: string;
  segs: Segment[];
  key: string;
}

type Block =
  | { kind: 'single'; el: Wrapped }
  | { kind: 'speech'; char: Wrapped; parts: Wrapped[] }
  | { kind: 'dual'; left: { char: Wrapped; parts: Wrapped[] }; right: { char: Wrapped; parts: Wrapped[] } };

const SPEECH_PART = new Set<ElementType>(['dialogue', 'parenthetical', 'lyrics']);
const NO_SPLIT = new Set<ElementType>(['scene', 'shot', 'character', 'parenthetical', 'transition', 'newAct', 'endAct', 'image', 'outline', 'sequence']);

export function speakerName(text: string): string {
  return text.replace(/\([^)]*\)?/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

export function displayText(type: ElementType, text: string, spec: ElementSpec, omitted?: boolean): string {
  if (omitted && type === 'scene') return 'OMITTED';
  return spec.uppercase ? text.toUpperCase() : text;
}

function specFor(g: PageGeometry, line: LayoutLine): ElementSpec {
  const base = g.elements[line.type];
  if (line.dual && (line.type === 'character' || SPEECH_PART.has(line.type))) {
    const d = g.dual;
    const col = line.dual === 'left' ? d.leftCol : d.rightCol;
    if (line.type === 'character') return { ...base, left: col, width: d.width, align: 'center' };
    if (line.type === 'parenthetical') return { ...base, left: col + d.parenIndent, width: d.width - d.parenIndent * 2 };
    return { ...base, left: col, width: d.width };
  }
  if (line.align && line.align !== base.align) return { ...base, align: line.align };
  return base;
}

export function createLayoutEngine() {
  const cache = new Map<string, Wrapped>();

  function wrap(g: PageGeometry, line: LayoutLine): Wrapped {
    const key = `${line.type}|${line.dual ?? ''}|${line.align ?? ''}|${line.omitted ? 1 : 0}|${g.elements[line.type].width}|${line.text}`;
    const hit = cache.get(line.id);
    if (hit && hit.key === key) {
      hit.line = line;
      return hit;
    }
    const spec = specFor(g, line);
    const display = displayText(line.type, line.text, spec, line.omitted);
    const segs = line.type === 'image'
      ? [{ start: 0, end: 0 }]
      : wrapText(display, spec.width, spec.width + spec.hang);
    const w: Wrapped = { line, spec, display, segs, key };
    cache.set(line.id, w);
    return w;
  }

  function layout(lines: readonly LayoutLine[], options: Partial<LayoutOptions> = {}): LayoutResult {
    const opts = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
    const g = opts.geometry;
    const L = g.linesPerPage;
    const seen = new Set<string>();

    // 1. Wrap and group into blocks.
    const blocks: Block[] = [];
    let inOmitted = false;
    const visible: Wrapped[] = [];
    for (const line of lines) {
      if (line.type === 'scene') inOmitted = !!line.omitted;
      else if (inOmitted) continue;
      if (opts.hide.has(line.type)) continue;
      seen.add(line.id);
      visible.push(wrap(g, line));
    }
    if (cache.size > seen.size * 2 + 64) {
      for (const k of cache.keys()) if (!seen.has(k)) cache.delete(k);
    }
    for (let i = 0; i < visible.length; i++) {
      const w = visible[i];
      if (w.line.type === 'character') {
        const parts: Wrapped[] = [];
        let j = i + 1;
        while (j < visible.length && SPEECH_PART.has(visible[j].line.type) && visible[j].line.dual === w.line.dual && !visible[j].line.pageBreakBefore) {
          parts.push(visible[j]);
          j++;
        }
        const speech = { char: w, parts };
        if (w.line.dual === 'left' && j < visible.length && visible[j].line.type === 'character' && visible[j].line.dual === 'right') {
          const rc = visible[j];
          const rparts: Wrapped[] = [];
          let k = j + 1;
          while (k < visible.length && SPEECH_PART.has(visible[k].line.type) && visible[k].line.dual === 'right') {
            rparts.push(visible[k]);
            k++;
          }
          blocks.push({ kind: 'dual', left: speech, right: { char: rc, parts: rparts } });
          i = k - 1;
        } else {
          blocks.push({ kind: 'speech', ...speech });
          i = j - 1;
        }
      } else {
        blocks.push({ kind: 'single', el: w });
      }
    }

    // 2. Place blocks on pages.
    const pages: PageOut[] = [{ index: 0, rows: [], usedRows: 0 }];
    const info = new Map<string, LineInfo>();
    let page = pages[0];
    let r = 0;
    let pending: BreakInfo | null = null;
    let lastSpeaker = '';
    let inScene = false;

    const newPage = (more: boolean, contdName: string | undefined, manual: boolean) => {
      page.usedRows = r;
      if (opts.sceneContinueds && inScene && !manual) {
        page.rows.push(marginRow('continuedBottom', L + 1, 64, '(CONTINUED)'));
      }
      pending = { page: pages.length, filler: Math.max(0, L - r), more, contdName, manual };
      page = { index: pages.length, rows: [], usedRows: 0 };
      pages.push(page);
      r = 0;
    };

    const marginRow = (kind: RowKind, row: number, col: number, text: string, lineId = ''): Row => ({
      lineId, type: 'character', kind, row, col, text, start: 0, end: 0, bold: false, italic: false, underline: false,
    });

    const colFor = (w: Wrapped, text: string, segIndex: number): number => {
      const s = w.spec;
      if (s.align === 'right') return s.left + s.width - text.length;
      if (s.align === 'center') return s.left + (s.width - text.length) / 2;
      return s.left - (segIndex === 0 ? s.hang : 0);
    };

    const ensureInfo = (w: Wrapped, sb: number, contd: boolean): LineInfo => {
      let li = info.get(w.line.id);
      if (!li) {
        li = {
          page: page.index, row: r + sb, rows: w.segs.length, spaceBefore: sb,
          wraps: w.segs.slice(1).map((s) => s.start), contd, splits: [],
        };
        info.set(w.line.id, li);
      }
      return li;
    };

    /** Put segments [from, to) of an element at the cursor. */
    const place = (w: Wrapped, from: number, to: number, sb: number, contd = false) => {
      const li = ensureInfo(w, from === 0 ? sb : 0, contd);
      if (pending) {
        if (opts.sceneContinueds && inScene && !pending.manual && w.line.type !== 'scene') {
          page.rows.push(marginRow('continuedTop', -2, g.elements.scene.left, 'CONTINUED:'));
        }
        if (from === 0) li.breakBefore = pending;
        else li.splits.push({ ...pending, offset: w.segs[from].start });
        pending = null;
      }
      if (from === 0) r += sb;
      if (w.line.type === 'image') {
        const rows = Math.max(1, w.line.imageRows ?? 10);
        page.rows.push({
          lineId: w.line.id, type: 'image', kind: 'image', row: r, col: w.spec.left, text: '', start: 0, end: 0,
          bold: false, italic: false, underline: false, rows,
        });
        li.rows = rows;
        r += rows;
        return;
      }
      for (let i = from; i < to; i++) {
        const seg = w.segs[i];
        let text = w.display.slice(seg.start, seg.end);
        if (contd && i === w.segs.length - 1) text += ` ${opts.contdText}`;
        const row: Row = {
          lineId: w.line.id, type: w.line.type, kind: 'text', row: r, col: colFor(w, text, i), text,
          start: seg.start, end: seg.end, bold: w.spec.bold, italic: w.spec.italic, underline: w.spec.underline,
        };
        if (i === 0 && w.line.sceneNumber && w.line.type === 'scene') row.sceneNumber = w.line.sceneNumber;
        if (w.line.revisionMarked) row.revisionMarked = true;
        page.rows.push(row);
        r++;
      }
    };

    const rowsOf = (w: Wrapped) => (w.line.type === 'image' ? Math.max(1, w.line.imageRows ?? 10) : w.segs.length);
    const sbOf = (w: Wrapped, atRow: number) => (atRow === 0 ? 0 : w.spec.spaceBefore);
    const rowText = (w: Wrapped, i: number) => w.display.slice(w.segs[i].start, w.segs[i].end);

    /** Valid split sizes for a splittable single element: k rows stay, n - k move. */
    const splitOk = (w: Wrapped, k: number): boolean => {
      const n = w.segs.length;
      if (k < 2 || n - k < 2) return false;
      return !opts.splitAtSentences || endsSentence(rowText(w, k - 1));
    };

    const canSplitSingle = (w: Wrapped) =>
      !NO_SPLIT.has(w.line.type) && (SPEECH_PART.has(w.line.type) ? opts.splitDialogue : opts.splitAction);

    interface SRow { w: Wrapped; seg: number; }
    const speechRows = (parts: Wrapped[]): SRow[] => {
      const out: SRow[] = [];
      for (const w of parts) for (let i = 0; i < w.segs.length; i++) out.push({ w, seg: i });
      return out;
    };
    const speechSplitOk = (rows: SRow[], k: number): boolean => {
      if (k < 2 || rows.length - k < 2) return false;
      const last = rows[k - 1];
      if (last.w.line.type === 'parenthetical') return false;
      if (last.seg === last.w.segs.length - 1) return true;
      return !opts.splitAtSentences || endsSentence(rowText(last.w, last.seg));
    };

    /** Rows a block needs on the current page to start there (without its space before). */
    const minChunk = (b: Block): number => {
      if (b.kind === 'single') {
        const n = rowsOf(b.el);
        if (canSplitSingle(b.el)) for (let k = 2; k <= n - 2; k++) if (splitOk(b.el, k)) return k;
        return n;
      }
      if (b.kind === 'dual') {
        return Math.max(
          rowsOf(b.left.char) + b.left.parts.reduce((a, p) => a + rowsOf(p), 0),
          rowsOf(b.right.char) + b.right.parts.reduce((a, p) => a + rowsOf(p), 0),
        );
      }
      const rows = speechRows(b.parts);
      const nc = rowsOf(b.char);
      if (opts.splitDialogue) for (let k = 2; k <= rows.length - 2; k++) if (speechSplitOk(rows, k)) return nc + k;
      return nc + rows.length;
    };
    const firstOf = (b: Block): Wrapped => (b.kind === 'single' ? b.el : b.kind === 'speech' ? b.char : b.left.char);
    const startsPage = (b: Block | undefined) => !!b && (firstOf(b).line.pageBreakBefore || firstOf(b).line.type === 'newAct');

    /** Rows needed to start block i on this page, including what must stay with it. */
    const required = (i: number, atRow: number, depth = 0): number => {
      const b = blocks[i];
      const first = firstOf(b);
      let need = sbOf(first, atRow) + minChunk(b);
      const next = blocks[i + 1];
      if (b.kind === 'single' && next && !startsPage(next) && depth < 4) {
        if (b.el.line.type === 'scene' || b.el.line.type === 'shot' || b.el.line.type === 'sequence' || b.el.line.type === 'outline') {
          // A heading keeps the start of what follows.
          need = sbOf(first, atRow) + rowsOf(b.el) + required(i + 1, 1, depth + 1);
        }
      }
      return need;
    };

    const isTransition = (b: Block | undefined) => !!b && b.kind === 'single' && b.el.line.type === 'transition';

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const first = firstOf(b);
      const next = blocks[i + 1];

      // Forced breaks: manual page break, or a new act (unless it opens the page already).
      if ((first.line.pageBreakBefore || first.line.type === 'newAct') && r > 0) {
        newPage(false, undefined, true);
      }
      if (r > 0 && r + required(i, r) > L) newPage(false, undefined, false);

      if (b.kind === 'single') {
        const w = b.el;
        if (w.line.type === 'scene') { inScene = true; lastSpeaker = ''; }
        const n = rowsOf(w);
        let from = 0;
        // A transition must not start a page alone: keep the tail of this element with it.
        const glue = isTransition(next) && !startsPage(next) ? next!.kind === 'single' ? sbOf(next.el, 1) + rowsOf(next.el) : 0 : 0;
        for (;;) {
          const sb = from === 0 ? sbOf(w, r) : 0;
          const avail = L - r - sb;
          const rest = n - from;
          if (rest + glue <= avail || w.line.type === 'image') { place(w, from, n, sb); break; }
          let k = 0;
          if (canSplitSingle(w)) {
            const maxK = Math.min(avail, rest - 2);
            for (let c = maxK; c >= 2; c--) {
              if (splitOkFrom(w, from, c)) { k = c; break; }
            }
          }
          if (k === 0) {
            if (r > 0 && from === 0) { newPage(false, undefined, false); continue; }
            if (rest <= avail) { place(w, from, n, sb); break; }
            // Longer than a page with no legal split: fill the page.
            k = Math.max(1, avail);
          }
          place(w, from, from + k, sb);
          from += k;
          newPage(false, undefined, false);
        }
        continue;
      }

      if (b.kind === 'dual') {
        const sb = sbOf(b.left.char, r);
        const top = r + sb;
        let maxR = top;
        for (const side of [b.left, b.right]) {
          r = top;
          place(side.char, 0, side.char.segs.length, 0);
          for (const p of side.parts) place(p, 0, p.segs.length, 0);
          maxR = Math.max(maxR, r);
        }
        info.get(b.left.char.line.id)!.spaceBefore = sb;
        info.get(b.right.char.line.id)!.spaceBefore = sb;
        r = maxR;
        lastSpeaker = '';
        continue;
      }

      // Speech block: character + dialogue/parenthetical rows.
      const name = speakerName(b.char.display);
      const hasContd = /\(CONT['’]D\)/i.test(b.char.display);
      const contd = opts.autoContd && !hasContd && name !== '' && name === lastSpeaker;
      lastSpeaker = name;
      const rows = speechRows(b.parts);
      const nc = rowsOf(b.char);
      let done = 0;
      let placedChar = false;
      const contdName = `${b.char.display.replace(/\s*\(CONT['’]D\)\s*$/i, '')} ${opts.contdText}`;
      const placeRows = (count: number) => {
        let c = count;
        while (c > 0) {
          const { w, seg } = rows[done];
          const take = Math.min(c, w.segs.length - seg);
          place(w, seg, seg + take, 0);
          done += take;
          c -= take;
        }
      };
      for (;;) {
        const sb = placedChar ? 0 : sbOf(b.char, r);
        const head = placedChar ? 0 : nc;
        const avail = L - r - sb - head;
        const rest = rows.length - done;
        if (rest <= avail) {
          if (!placedChar) { place(b.char, 0, nc, sb, contd); placedChar = true; }
          placeRows(rest);
          break;
        }
        let k = 0;
        if (opts.splitDialogue) {
          const sub = rows.slice(done);
          for (let c = Math.min(avail, rest - 2); c >= 2; c--) {
            if (speechSplitOk(sub, c)) { k = c; break; }
          }
        }
        if (k === 0) {
          if (r > 0 && !placedChar) { newPage(false, undefined, false); continue; }
          k = Math.max(1, Math.min(avail, rest));
          if (avail <= 0) { newPage(false, undefined, false); continue; }
        }
        if (!placedChar) { place(b.char, 0, nc, sb, contd); placedChar = true; }
        placeRows(k);
        page.rows.push(marginRow('more', r, g.elements.character.left, opts.moreText, b.char.line.id));
        newPage(true, contdName, false);
        page.rows.push(marginRow('contd', -1, g.elements.character.left, contdName, b.char.line.id));
      }
    }
    page.usedRows = r;
    return { pages, info };

    function splitOkFrom(w: Wrapped, from: number, k: number): boolean {
      const rest = w.segs.length - from;
      if (k < 2 || rest - k < 2) return false;
      return !opts.splitAtSentences || endsSentence(rowText(w, from + k - 1));
    }
  }

  return { layout, clear: () => cache.clear() };
}

export type LayoutEngine = ReturnType<typeof createLayoutEngine>;
