// Document history: local versions kept in IndexedDB plus the scripts repo's commit history.
import { db } from '../storage/db';
import type { DocumentFile, ElementType, Line, ProjectFile } from '../storage/models';
import { getGitApi } from '../sync/engine';

export interface Version {
  key: string;
  at: string;
  label: string;
  source: 'local' | 'commit' | 'current';
  sha?: string;
}

interface LocalVersion { at: string; lines: Line[] }

const LOCAL_GAP_MS = 4 * 60 * 1000;
const LOCAL_MAX = 25;
const docPath = (p: ProjectFile, d: DocumentFile) => `projects/${p.path}/documents/${d.id}.json`;

/** Keep a local copy of the document now and then, so history works offline too. */
export async function recordLocalVersion(doc: DocumentFile, force = false) {
  const key = `local:${doc.id}`;
  const list: LocalVersion[] = (await db.historyCache.get(key))?.value ?? [];
  const last = list[list.length - 1];
  const now = Date.now();
  if (!force && last && now - new Date(last.at).getTime() < LOCAL_GAP_MS) return;
  list.push({ at: new Date(now).toISOString(), lines: doc.lines.map((l) => ({ ...l })) });
  while (list.length > LOCAL_MAX) list.shift();
  await db.historyCache.put({ key, value: list });
}

export async function listVersions(project: ProjectFile, doc: DocumentFile): Promise<Version[]> {
  const out: Version[] = [];
  const local: LocalVersion[] = (await db.historyCache.get(`local:${doc.id}`))?.value ?? [];
  for (const v of local) out.push({ key: `local:${v.at}`, at: v.at, label: 'Saved on this device', source: 'local' });
  const api = getGitApi();
  const cacheKey = `commits:${doc.id}`;
  let commits: { sha: string; date: string; message: string }[] = (await db.historyCache.get(cacheKey))?.value ?? [];
  if (api && navigator.onLine !== false) {
    try {
      commits = await api.listCommits(docPath(project, doc));
      await db.historyCache.put({ key: cacheKey, value: commits });
    } catch { /* keep the cached list */ }
  }
  for (const c of commits) out.push({ key: `commit:${c.sha}`, at: c.date, label: c.message.split('\n')[0], source: 'commit', sha: c.sha });
  out.sort((a, b) => a.at.localeCompare(b.at));
  return out;
}

export async function loadVersion(project: ProjectFile, doc: DocumentFile, v: Version): Promise<Line[] | null> {
  if (v.source === 'current') return doc.lines;
  if (v.source === 'local') {
    const local: LocalVersion[] = (await db.historyCache.get(`local:${doc.id}`))?.value ?? [];
    return local.find((x) => `local:${x.at}` === v.key)?.lines ?? null;
  }
  const cacheKey = `doc:${v.sha}:${doc.id}`;
  const hit = await db.historyCache.get(cacheKey);
  if (hit) return hit.value;
  const api = getGitApi();
  if (!api || !v.sha) return null;
  const text = await api.readFileAt(docPath(project, doc), v.sha);
  if (!text) return null;
  const lines = (JSON.parse(text) as DocumentFile).lines;
  await db.historyCache.put({ key: cacheKey, value: lines });
  return lines;
}

export interface LineVersion { at: string; text: string; type: ElementType; source: string }

/** Every past version of one line, newest first. Built by walking versions and comparing by line id. */
export async function lineHistory(project: ProjectFile, doc: DocumentFile, lineId: string, maxVersions = 40): Promise<LineVersion[]> {
  const versions = (await listVersions(project, doc)).slice(-maxVersions);
  const out: LineVersion[] = [];
  const cur = doc.lines.find((l) => l.id === lineId);
  for (const h of cur?.history ?? []) out.push({ at: h.at, text: h.text, type: h.type, source: 'Other device' });
  for (const v of versions) {
    const lines = await loadVersion(project, doc, v).catch(() => null);
    const l = lines?.find((x) => x.id === lineId);
    if (l) out.push({ at: l.updatedAt && l.updatedAt <= v.at ? l.updatedAt : v.at, text: l.text, type: l.type, source: v.source === 'commit' ? 'Scripts repo' : 'This device' });
  }
  if (cur) out.push({ at: cur.updatedAt, text: cur.text, type: cur.type, source: 'Current' });
  out.sort((a, b) => b.at.localeCompare(a.at));
  // Drop consecutive duplicates.
  return out.filter((v, i) => i === 0 || v.text !== out[i - 1].text || v.type !== out[i - 1].type);
}
