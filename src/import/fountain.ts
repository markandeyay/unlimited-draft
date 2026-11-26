// Fountain writer (repo mirror) and parser (import).
import type { ElementType } from '../layout/geometry';
import { SCENE_START } from '../editor/flow';

export interface PlainLine { type: ElementType; text: string; dual?: 'left' | 'right' }

/** Write lines as Fountain. Used for the read-only mirror in the scripts repo. */
export function toFountain(lines: readonly PlainLine[], title?: string): string {
  const out: string[] = [];
  if (title) out.push(`Title: ${title}`, '');
  let prev: ElementType | null = null;
  for (const l of lines) {
    const t = l.text;
    switch (l.type) {
      case 'scene': out.push('', SCENE_START.test(t) ? t.toUpperCase() : `.${t.toUpperCase()}`, ''); break;
      case 'action': out.push(prev === 'action' || prev === 'text' ? '' : '', /^[A-Z0-9 ()'.-]+$/.test(t) && t.trim() ? `!${t}` : t, ''); break;
      case 'character': out.push('', `${/[a-z]/.test(t) ? '@' : ''}${t.toUpperCase()}${l.dual === 'right' ? ' ^' : ''}`); break;
      case 'parenthetical': out.push(/^\(.*\)$/.test(t) ? t : `(${t})`); break;
      case 'dialogue': out.push(t); break;
      case 'lyrics': out.push(`~${t}`); break;
      case 'transition': out.push('', /TO:$/.test(t.toUpperCase()) ? t.toUpperCase() : `> ${t.toUpperCase()}`, ''); break;
      case 'shot': out.push('', `!${t.toUpperCase()}`, ''); break;
      case 'note': out.push('', `[[${t}]]`, ''); break;
      case 'outline': out.push('', `## ${t}`, ''); break;
      case 'sequence': out.push('', `# ${t}`, ''); break;
      case 'newAct': out.push('', `> ${t.toUpperCase()} <`, ''); break;
      case 'endAct': out.push('', `> ${t.toUpperCase()} <`, ''); break;
      case 'image': out.push('', '[[image]]', ''); break;
      default: out.push(t);
    }
    prev = l.type;
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** Parse Fountain text into lines. Covers the syntax WriterDuet exports. */
export function parseFountain(src: string): { title?: string; author?: string; lines: PlainLine[] } {
  let text = src.replace(/\r\n?/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
  let title: string | undefined;
  let author: string | undefined;
  // Title page block: key: value lines up to the first blank line.
  if (/^[A-Za-z ]+:/.test(text) && !SCENE_START.test(text)) {
    const end = text.indexOf('\n\n');
    const head = end === -1 ? text : text.slice(0, end);
    if (head.split('\n').every((l) => /^([A-Za-z ]+:|\s+)/.test(l) || l.trim() === '')) {
      const tm = head.match(/^Title:\s*(.*(?:\n\s+.+)*)/im);
      if (tm) title = tm[1].replace(/\n\s+/g, ' ').replace(/[_*]/g, '').trim();
      const am = head.match(/^Authors?:\s*(.+)/im);
      if (am) author = am[1].trim();
      text = end === -1 ? '' : text.slice(end + 2);
    }
  }
  const raw = text.split('\n');
  const lines: PlainLine[] = [];
  const strip = (s: string) => s.replace(/\*{1,3}|_/g, '');
  let i = 0;
  let inDialogue = false;
  const blank = (k: number) => k < 0 || k >= raw.length || raw[k].trim() === '';
  while (i < raw.length) {
    const line = raw[i];
    const t = line.trim();
    if (t === '') { inDialogue = false; i++; continue; }
    if (t === '===') { i++; continue; }
    if (inDialogue) {
      if (/^\(.*\)$/.test(t)) lines.push({ type: 'parenthetical', text: t, dual: lines[lines.length - 1]?.dual });
      else if (t.startsWith('~')) lines.push({ type: 'lyrics', text: strip(t.slice(1).trim()), dual: lines[lines.length - 1]?.dual });
      else {
        const last = lines[lines.length - 1];
        if (last?.type === 'dialogue') last.text += ` ${strip(t)}`;
        else lines.push({ type: 'dialogue', text: strip(t), dual: last?.dual });
      }
      i++;
      continue;
    }
    const note = t.match(/^\[\[([\s\S]*?)\]\]$/);
    if (note) { lines.push({ type: 'note', text: note[1].trim() }); i++; continue; }
    if (/^#{2,}\s*/.test(t)) { lines.push({ type: 'outline', text: t.replace(/^#+\s*/, '') }); i++; continue; }
    if (/^#\s*/.test(t)) { lines.push({ type: 'sequence', text: t.replace(/^#\s*/, '') }); i++; continue; }
    if (/^=(?!=)/.test(t)) { lines.push({ type: 'outline', text: t.slice(1).trim() }); i++; continue; }
    const centered = t.match(/^>\s*(.+?)\s*<$/);
    if (centered) {
      const c = strip(centered[1]);
      lines.push({ type: /^END\b/i.test(c) ? 'endAct' : /\bACT\b|TEASER|TAG|COLD OPEN/i.test(c) ? 'newAct' : 'action', text: c });
      i++;
      continue;
    }
    if (t.startsWith('>')) { lines.push({ type: 'transition', text: strip(t.slice(1).trim()) }); i++; continue; }
    if (t.startsWith('.') && !t.startsWith('..')) { lines.push({ type: 'scene', text: strip(t.slice(1)).replace(/\s*#[^#]+#\s*$/, '') }); i++; continue; }
    if (t.startsWith('!')) { lines.push({ type: 'action', text: strip(t.slice(1)) }); i++; continue; }
    if (t.startsWith('~')) { lines.push({ type: 'lyrics', text: strip(t.slice(1).trim()) }); i++; continue; }
    if (SCENE_START.test(t) && blank(i - 1) && blank(i + 1)) {
      lines.push({ type: 'scene', text: strip(t).replace(/\s*#[^#]+#\s*$/, '') });
      i++;
      continue;
    }
    if (blank(i - 1) && blank(i + 1) && t === t.toUpperCase() && /TO:$/.test(t)) { lines.push({ type: 'transition', text: t }); i++; continue; }
    const forcedChar = t.startsWith('@');
    if ((forcedChar || (t === t.toUpperCase() && /[A-Z]/.test(t))) && blank(i - 1) && !blank(i + 1)) {
      let name = forcedChar ? t.slice(1) : t;
      let dual: 'left' | 'right' | undefined;
      if (/\^\s*$/.test(name)) {
        name = name.replace(/\s*\^\s*$/, '');
        dual = 'right';
        // The previous character block becomes the left side.
        for (let k = lines.length - 1; k >= 0; k--) {
          const p = lines[k];
          if (p.type !== 'character' && p.type !== 'dialogue' && p.type !== 'parenthetical' && p.type !== 'lyrics') break;
          p.dual = 'left';
          if (p.type === 'character') break;
        }
      }
      lines.push({ type: 'character', text: name.trim(), dual });
      inDialogue = true;
      i++;
      continue;
    }
    // Action: consecutive non-blank lines form one paragraph.
    const last = lines[lines.length - 1];
    if (last?.type === 'action' && !blank(i - 1) && raw[i - 1].trim() !== '' && !raw[i - 1].trim().startsWith('!') ) last.text += ` ${strip(t)}`;
    else lines.push({ type: 'action', text: strip(t) });
    i++;
  }
  return { title, author, lines };
}
