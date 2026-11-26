// Spell check worker: nspell with an English Hunspell dictionary. Works offline (files are precached).
import nspell from 'nspell';

type Req =
  | { id: number; type: 'check'; words: string[] }
  | { id: number; type: 'suggest'; word: string }
  | { id: number; type: 'add'; words: string[] };

let spell: ReturnType<typeof nspell> | null = null;
let loading: Promise<void> | null = null;

async function load() {
  const [aff, dic] = await Promise.all([fetch('/dict/en.aff').then((r) => r.text()), fetch('/dict/en.dic').then((r) => r.text())]);
  spell = nspell(aff, dic);
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const m = e.data;
  try {
    if (!spell) await (loading ??= load());
    const sp = spell!;
    if (m.type === 'check') {
      const bad = m.words.filter((w) => !sp.correct(w) && !sp.correct(w.replace(/’/g, "'")) && !sp.correct(w.replace(/'s$/i, '')));
      (self as any).postMessage({ id: m.id, result: bad });
    } else if (m.type === 'suggest') {
      (self as any).postMessage({ id: m.id, result: sp.suggest(m.word).slice(0, 7) });
    } else {
      for (const w of m.words) sp.add(w);
      (self as any).postMessage({ id: m.id, result: true });
    }
  } catch (err) {
    (self as any).postMessage({ id: m.id, error: String(err) });
  }
};
