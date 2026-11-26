// Monospace line wrapping. Pure string math, no DOM.

export interface Segment {
  /** Offset of the first character of this visual row in the source text. */
  start: number;
  /** Offset just past the last visible character (trailing spaces excluded). */
  end: number;
}

/**
 * Wrap text to rows of at most `width` characters, breaking on the last space.
 * Spaces at a break hang past the edge (they belong to the row they end).
 * Words longer than a row are hard-broken. `firstWidth` lets the first row differ (hanging indent).
 * A "\n" in the text is a forced break.
 */
export function wrapText(text: string, width: number, firstWidth = width): Segment[] {
  const out: Segment[] = [];
  const n = text.length;
  let pos = 0;
  if (n === 0) return [{ start: 0, end: 0 }];
  while (pos <= n) {
    const w = Math.max(1, out.length === 0 ? firstWidth : width);
    const nl = text.indexOf('\n', pos);
    const hardEnd = nl === -1 ? n : nl;
    if (hardEnd - pos <= w) {
      out.push({ start: pos, end: trimEnd(text, pos, hardEnd) });
      if (nl === -1) break;
      pos = nl + 1;
      if (pos === n) { out.push({ start: n, end: n }); break; }
      continue;
    }
    const limit = pos + w;
    let brk: number;
    if (text.charCodeAt(limit) === 32) {
      brk = limit;
    } else {
      brk = text.lastIndexOf(' ', limit - 1);
      if (brk <= pos) brk = -1;
    }
    if (brk === -1) {
      out.push({ start: pos, end: limit });
      pos = limit;
    } else {
      let next = brk;
      while (next < hardEnd && text.charCodeAt(next) === 32) next++;
      out.push({ start: pos, end: trimEnd(text, pos, brk) });
      pos = next;
      if (pos >= hardEnd) {
        // Only spaces remained before the end or a newline.
        if (nl === -1) break;
        pos = nl + 1;
        if (pos === n) { out.push({ start: n, end: n }); break; }
      }
    }
  }
  return out;
}

function trimEnd(text: string, start: number, end: number): number {
  while (end > start && text.charCodeAt(end - 1) === 32) end--;
  return end;
}

const SENTENCE_END = /[.?!]["')\]”’]*$/;

/** True when the visible row text ends a sentence. */
export function endsSentence(rowText: string): boolean {
  return SENTENCE_END.test(rowText);
}
