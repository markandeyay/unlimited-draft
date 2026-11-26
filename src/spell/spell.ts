import { elType } from '../editor/schema';
// Main-thread side of the spell checker.
import type { Node as PMNode } from 'prosemirror-model';
import { db } from '../storage/db';
import type { Range } from '../editor/rangePlugin';

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
const good = new Set<string>();
const bad = new Set<string>();
let customLoaded: Promise<void> | null = null;

function ask<T>(msg: Record<string, unknown>): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.error) w.reject(new Error(e.data.error));
      else w.resolve(e.data.result);
    };
  }
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker!.postMessage({ id, ...msg });
  });
}

async function loadCustom() {
  const words: string[] = (await db.settings.get('dictionary'))?.value ?? [];
  if (words.length) await ask({ type: 'add', words });
}

export async function addToDictionary(word: string) {
  const words: string[] = (await db.settings.get('dictionary'))?.value ?? [];
  if (!words.includes(word)) words.push(word);
  await db.settings.put({ key: 'dictionary', value: words });
  await ask({ type: 'add', words: [word] });
  bad.delete(word);
  good.add(word);
}

export function ignoreWord(word: string) { bad.delete(word); good.add(word); }

export const suggest = (word: string) => ask<string[]>({ type: 'suggest', word });

const WORD = /[A-Za-z][A-Za-z'’]*[A-Za-z]|[A-Za-z]/g;

export interface Misspelling { word: string; from: number; to: number; lineId: string }

/** Find misspelled words in the document. Names of characters and ALL CAPS words are skipped. */
export async function checkDocument(doc: PMNode): Promise<Misspelling[]> {
  await (customLoaded ??= loadCustom());
  const names = new Set<string>();
  doc.forEach((n) => {
    if (n.type.name === 'character') for (const w of n.textContent.toUpperCase().match(WORD) ?? []) names.add(w);
  });
  const found: Misspelling[] = [];
  const unknown = new Set<string>();
  const skipTypes = new Set(['character', 'scene', 'transition', 'shot', 'image']);
  doc.forEach((n, pos) => {
    if (skipTypes.has(elType(n))) return;
    const text = n.textContent;
    WORD.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WORD.exec(text))) {
      const w = m[0];
      if (w.length < 2 || (w === w.toUpperCase()) || names.has(w.toUpperCase())) continue;
      if (good.has(w)) continue;
      if (!bad.has(w)) unknown.add(w);
      found.push({ word: w, from: pos + 1 + m.index, to: pos + 1 + m.index + w.length, lineId: n.attrs.id });
    }
  });
  if (unknown.size) {
    const list = [...unknown];
    const res = new Set(await ask<string[]>({ type: 'check', words: list }));
    for (const w of list) (res.has(w) ? bad : good).add(w);
  }
  return found.filter((f) => bad.has(f.word));
}

export const toRanges = (ms: Misspelling[]): Range[] => ms.map((m) => ({ from: m.from, to: m.to, cls: 'spell', attrs: { 'data-word': m.word } }));
