// Script analysis shared by cards, reports and search. Pure functions.
import type { ElementType } from '../layout/geometry';
import { speakerName } from '../layout/paginate';

export interface ALine { id: string; type: ElementType; text: string; omitted?: boolean }

export interface SceneInfo {
  id: string;
  /** Index of the heading in the lines array (-1 for content before the first heading). */
  start: number;
  /** Index just past the last line of the scene. */
  end: number;
  heading: string;
  intExt: string;
  location: string;
  time: string;
  body: ALine[];
  sequence?: string;
  characters: string[];
}

export function parseHeading(text: string): { intExt: string; location: string; time: string } {
  const t = text.trim().toUpperCase();
  const m = t.match(/^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|INT\.?|EXT\.?|I\/E\.?)\s+/);
  const intExt = m ? m[1].replace(/\.$/, '') : '';
  const rest = m ? t.slice(m[0].length) : t;
  const dash = rest.lastIndexOf(' - ');
  return dash >= 0
    ? { intExt, location: rest.slice(0, dash).trim(), time: rest.slice(dash + 3).trim() }
    : { intExt, location: rest.trim(), time: '' };
}

export function splitScenes(lines: readonly ALine[]): SceneInfo[] {
  const out: SceneInfo[] = [];
  let cur: SceneInfo | null = null;
  let sequence: string | undefined;
  lines.forEach((l, i) => {
    if (l.type === 'sequence') { sequence = l.text; }
    if (l.type === 'scene') {
      if (cur) cur.end = i;
      cur = { id: l.id, start: i, end: lines.length, heading: l.text.toUpperCase(), ...parseHeading(l.text), body: [], sequence, characters: [] };
      out.push(cur);
    } else if (cur) {
      if (l.type === 'sequence') { cur.end = i; cur = null; return; }
      cur.body.push(l);
      if (l.type === 'character') {
        const n = speakerName(l.text);
        if (n && !cur.characters.includes(n)) cur.characters.push(n);
      }
    }
  });
  return out;
}

export const wordCount = (text: string) => (text.trim().match(/[^\s]+/g) ?? []).length;

export interface CharacterStat { name: string; speeches: number; dialogueLines: number; words: number; scenes: number }

export function characterStats(lines: readonly ALine[]): CharacterStat[] {
  const map = new Map<string, CharacterStat>();
  let cur: CharacterStat | null = null;
  const sceneSeen = new Map<string, Set<string>>();
  let sceneId = '';
  for (const l of lines) {
    if (l.type === 'scene') { sceneId = l.id; cur = null; continue; }
    if (l.type === 'character') {
      const name = speakerName(l.text);
      if (!name) { cur = null; continue; }
      cur = map.get(name) ?? { name, speeches: 0, dialogueLines: 0, words: 0, scenes: 0 };
      map.set(name, cur);
      cur.speeches++;
      const set = sceneSeen.get(name) ?? new Set();
      set.add(sceneId);
      sceneSeen.set(name, set);
    } else if ((l.type === 'dialogue' || l.type === 'lyrics') && cur) {
      cur.dialogueLines++;
      cur.words += wordCount(l.text);
    } else if (l.type !== 'parenthetical') {
      cur = null;
    }
  }
  for (const c of map.values()) c.scenes = sceneSeen.get(c.name)?.size ?? 0;
  return [...map.values()].sort((a, b) => b.words - a.words || a.name.localeCompare(b.name));
}

export interface DocStats {
  pages: number;
  scenes: number;
  words: number;
  characters: number;
  dialogueWords: number;
  actionWords: number;
  dialoguePct: number;
  actionPct: number;
  runtimeMin: number;
  byCharacter: CharacterStat[];
  byLocation: { location: string; scenes: number }[];
}

export function documentStats(lines: readonly ALine[], pages: number): DocStats {
  let words = 0, dialogueWords = 0, actionWords = 0;
  for (const l of lines) {
    if (l.type === 'note' || l.type === 'outline' || l.type === 'sequence') continue;
    const w = wordCount(l.text);
    words += w;
    if (l.type === 'dialogue' || l.type === 'lyrics' || l.type === 'parenthetical') dialogueWords += w;
    else if (l.type === 'action' || l.type === 'text' || l.type === 'shot') actionWords += w;
  }
  const scenes = splitScenes(lines);
  const loc = new Map<string, number>();
  for (const s of scenes) if (s.location) loc.set(s.location, (loc.get(s.location) ?? 0) + 1);
  const byCharacter = characterStats(lines);
  const denom = dialogueWords + actionWords || 1;
  return {
    pages, scenes: scenes.length, words, characters: byCharacter.length, dialogueWords, actionWords,
    dialoguePct: Math.round((dialogueWords / denom) * 100), actionPct: Math.round((actionWords / denom) * 100),
    runtimeMin: pages, byCharacter,
    byLocation: [...loc.entries()].map(([location, n]) => ({ location, scenes: n })).sort((a, b) => b.scenes - a.scenes || a.location.localeCompare(b.location)),
  };
}

/** Line ids for dialogue-only view (optionally limited to some characters). */
export function dialogueIds(lines: readonly ALine[], only?: Set<string>): string[] {
  const out: string[] = [];
  let keep = false;
  for (const l of lines) {
    if (l.type === 'character') { keep = !only || only.size === 0 || only.has(speakerName(l.text)); if (keep) out.push(l.id); }
    else if (l.type === 'dialogue' || l.type === 'parenthetical' || l.type === 'lyrics') { if (keep) out.push(l.id); }
    else keep = false;
  }
  return out;
}

export function nonDialogueIds(lines: readonly ALine[]): string[] {
  return lines.filter((l) => !['character', 'dialogue', 'parenthetical', 'lyrics'].includes(l.type)).map((l) => l.id);
}

/** Line ids of the scenes in which any of the chosen characters speak. */
export function characterSceneIds(lines: readonly ALine[], names: Set<string>): string[] {
  const out: string[] = [];
  for (const s of splitScenes(lines)) {
    if (!s.characters.some((c) => names.has(c))) continue;
    for (let i = s.start; i < s.end; i++) out.push(lines[i].id);
  }
  return out;
}
