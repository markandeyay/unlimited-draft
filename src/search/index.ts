// Full-text search across every script, in the browser.
import MiniSearch from 'minisearch';
import { db } from '../storage/db';

export interface SearchHit {
  projectId: string;
  projectName: string;
  docId: string;
  docName: string;
  lineId: string;
  type: string;
  text: string;
  score: number;
}

interface Entry { id: string; text: string; projectId: string; docId: string; lineId: string; type: string }

let index: MiniSearch<Entry> | null = null;
let stamp = '';
let names = new Map<string, string>();
let docNames = new Map<string, string>();

const make = () => new MiniSearch<Entry>({
  fields: ['text'],
  storeFields: ['text', 'projectId', 'docId', 'lineId', 'type'],
  searchOptions: { prefix: true, fuzzy: 0.15, combineWith: 'AND' },
});

/** Build (or reuse) the index. The cache key is the newest document timestamp plus the document count. */
export async function ensureIndex(): Promise<MiniSearch<Entry>> {
  const projects = (await db.projects.toArray()).filter((p) => !p.deleted);
  const docs = await db.documents.toArray();
  const key = `${docs.length}:${docs.reduce((m, d) => (d.updatedAt > m ? d.updatedAt : m), '')}:${projects.map((p) => p.name).join('|').length}`;
  names = new Map(projects.map((p) => [p.id, p.name]));
  docNames = new Map(docs.map((d) => [d.id, d.name]));
  if (index && key === stamp) return index;
  const cached = await db.searchIndex.get('index');
  if (cached?.value?.key === key) {
    try {
      index = MiniSearch.loadJSON<Entry>(cached.value.json, {
        fields: ['text'], storeFields: ['text', 'projectId', 'docId', 'lineId', 'type'],
        searchOptions: { prefix: true, fuzzy: 0.15, combineWith: 'AND' },
      });
      stamp = key;
      return index;
    } catch { /* rebuild below */ }
  }
  const idx = make();
  const entries: Entry[] = [];
  for (const d of docs) {
    if (!names.has(d.projectId)) continue;
    for (const l of d.lines) {
      if (!l.text.trim()) continue;
      entries.push({ id: `${d.id}:${l.id}`, text: l.text, projectId: d.projectId, docId: d.id, lineId: l.id, type: l.type });
    }
  }
  idx.addAll(entries);
  index = idx;
  stamp = key;
  void db.searchIndex.put({ key: 'index', value: { key, json: JSON.stringify(idx) } }).catch(() => undefined);
  return idx;
}

export async function searchAll(query: string, limit = 60): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const idx = await ensureIndex();
  const res = idx.search(q).slice(0, limit);
  return res.map((r) => ({
    projectId: r.projectId, projectName: names.get(r.projectId) ?? '', docId: r.docId, docName: docNames.get(r.docId) ?? '',
    lineId: r.lineId, type: r.type, text: r.text, score: r.score,
  }));
}

/** Split text into parts so matched words can be highlighted. */
export function highlightParts(text: string, query: string): { text: string; hit: boolean }[] {
  const terms = query.trim().split(/\s+/).filter((t) => t.length > 1).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!terms.length) return [{ text, hit: false }];
  const re = new RegExp(`(${terms.join('|')})`, 'ig');
  return text.split(re).filter(Boolean).map((p) => ({ text: p, hit: terms.some((t) => new RegExp(`^${t}$`, 'i').test(p)) }));
}
