// Final Draft (.fdx) import. WriterDuet's free tier can export this format.
import type { ElementType } from '../layout/geometry';
import type { PlainLine } from './fountain';

const TYPE_MAP: Record<string, ElementType> = {
  'scene heading': 'scene',
  action: 'action',
  character: 'character',
  parenthetical: 'parenthetical',
  dialogue: 'dialogue',
  transition: 'transition',
  shot: 'shot',
  general: 'text',
  lyric: 'lyrics',
  lyrics: 'lyrics',
  'new act': 'newAct',
  'end of act': 'endAct',
  'end act': 'endAct',
  'cast list': 'text',
  'outline 1': 'sequence',
  'outline 2': 'outline',
  'outline body': 'outline',
};

const decode = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&amp;/g, '&');

export function parseFdx(xml: string): { title?: string; lines: PlainLine[] } {
  const start = xml.indexOf('<Content');
  const end = xml.indexOf('</Content>');
  const body = start >= 0 ? xml.slice(start, end >= 0 ? end : undefined) : xml;
  const lines: PlainLine[] = [];
  const tag = /<(\/?)(Paragraph|DualDialogue|Text)\b([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  let cur: { type: ElementType; text: string } | null = null;
  let textStart = -1;
  let inDual = false;
  let dualCount = 0;
  const flush = () => {
    if (!cur) return;
    const line: PlainLine = { type: cur.type, text: cur.text.replace(/\s+/g, ' ').trim() };
    if (inDual) {
      if (cur.type === 'character') dualCount++;
      line.dual = dualCount <= 1 ? 'left' : 'right';
    }
    if (line.text || cur.type === 'action') { if (line.text) lines.push(line); }
    cur = null;
  };
  while ((m = tag.exec(body))) {
    const [, close, name, attrs, selfClose] = m;
    if (name === 'DualDialogue') {
      if (close) { inDual = false; } else { flush(); inDual = true; dualCount = 0; }
      continue;
    }
    if (name === 'Paragraph') {
      if (close) { flush(); continue; }
      flush();
      const t = /Type="([^"]*)"/.exec(attrs)?.[1]?.toLowerCase() ?? 'action';
      cur = { type: TYPE_MAP[t] ?? 'action', text: '' };
      if (selfClose) flush();
      continue;
    }
    // Text
    if (close) {
      if (cur && textStart >= 0) cur.text += decode(body.slice(textStart, m.index));
      textStart = -1;
    } else if (!selfClose) {
      textStart = tag.lastIndex;
    }
  }
  flush();
  // Title from the title page block, if present.
  let title: string | undefined;
  const tp = xml.indexOf('<TitlePage');
  if (tp >= 0) {
    const texts = [...xml.slice(tp).matchAll(/<Text\b[^>]*>([\s\S]*?)<\/Text>/g)].map((x) => decode(x[1]).trim()).filter(Boolean);
    title = texts[0];
  }
  return { title, lines };
}
