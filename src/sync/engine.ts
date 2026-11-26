// Offline-first sync. Edits land in IndexedDB; this engine batches them into commits on the scripts repo.
import { useApp } from '../app/store';
import { toFountain } from '../import/fountain';
import { mergeSettings, useSettings } from '../settings/settings';
import { db, getFolders, onDirty } from '../storage/db';
import type { Comment, DocumentFile, LibraryFile, ProjectFile, Settings, Snapshot } from '../storage/models';
import { AuthError, type Change, type GitApi, type Head, utf8 } from './github';
import { mergeDocuments } from './merge';

interface SyncMeta { headSha: string; known: Record<string, string>; lastSyncAt: string }

let api: GitApi | null = null;
let running: Promise<boolean> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastCommitAt = 0;
let pendingMessage: string | null = null;
let afterRemoteChange: (() => void) | null = null;

export function setGitApi(a: GitApi | null) { api = a; }
export function onRemoteChange(fn: () => void) { afterRemoteChange = fn; }
export const hasApi = () => !!api;
export const getGitApi = () => api;

const setStatus = (p: Partial<ReturnType<typeof useApp.getState>['sync']>) =>
  useApp.setState((s) => ({ sync: { ...s.sync, ...p } }));

async function getMeta(): Promise<SyncMeta> {
  return (await db.settings.get('syncMeta'))?.value ?? { headSha: '', known: {}, lastSyncAt: new Date(0).toISOString() };
}
const putMeta = (m: SyncMeta) => db.settings.put({ key: 'syncMeta', value: m });

const json = (v: unknown) => `${JSON.stringify(v, null, 1)}\n`;
const docPath = (p: ProjectFile, id: string) => `projects/${p.path}/documents/${id}.json`;

export async function buildLibrary(): Promise<LibraryFile> {
  const projects = (await db.projects.toArray()).filter((p) => !p.deleted);
  return {
    schema: 1,
    folders: await getFolders(),
    projects: projects.map((p) => ({
      id: p.id, path: `projects/${p.path}`, name: p.name, folderId: p.folderId, pageCount: p.pageCount,
      updatedAt: p.updatedAt, openedAt: p.openedAt, createdAt: p.createdAt,
    })),
  };
}

/** Turn dirty keys into file changes for one commit. */
export async function buildChanges(keys: string[], git: GitApi, tree: () => Promise<{ path: string }[]>): Promise<{ changes: Change[]; message: string }> {
  const changes = new Map<string, Change>();
  let message = '';
  const projectOf = async (id: string) => db.projects.get(id);
  for (const key of keys) {
    const [kind, ...restParts] = key.split(':');
    const rest = restParts.join(':');
    if (kind === 'doc') {
      const d = await db.documents.get(rest);
      const p = d && (await projectOf(d.projectId));
      if (!d || !p) continue;
      changes.set(docPath(p, d.id), { path: docPath(p, d.id), content: json(d) });
      const fp = `projects/${p.path}/documents/${d.id}.fountain`;
      changes.set(fp, { path: fp, content: toFountain(d.lines, d.kind === 'script' ? p.name : undefined) });
      if (!message) message = `Edit: ${p.name} / ${d.name}`;
    } else if (kind === 'project') {
      const p = await projectOf(rest);
      if (!p) continue;
      const path = `projects/${p.path}/project.json`;
      changes.set(path, { path, content: json(p) });
    } else if (kind === 'comments') {
      const d = await db.documents.get(rest);
      const p = d && (await projectOf(d.projectId));
      if (!d || !p) continue;
      const path = `projects/${p.path}/comments/${d.id}.json`;
      changes.set(path, { path, content: json(await db.comments.where('docId').equals(d.id).toArray()) });
    } else if (kind === 'snapshots') {
      const p = await projectOf(rest);
      if (!p) continue;
      const path = `projects/${p.path}/snapshots.json`;
      const snaps = (await db.snapshots.where('projectId').equals(p.id).toArray()).map(({ lines: _l, ...s }) => s);
      changes.set(path, { path, content: json(snaps) });
    } else if (kind === 'asset') {
      const a = await db.assets.get(rest);
      const p = a && (await projectOf(a.projectId));
      if (!a || !p) continue;
      const buf = a.data instanceof Blob ? await a.data.arrayBuffer() : a.data;
      const ext = (a.type.split('/')[1] ?? 'bin').replace('jpeg', 'jpg');
      const path = `projects/${p.path}/assets/${a.id}.${ext}`;
      changes.set(path, { path, blobSha: await git.createBlob(new Uint8Array(buf)) });
    } else if (kind === 'library') {
      changes.set('library.json', { path: 'library.json', content: json(await buildLibrary()) });
    } else if (kind === 'settings') {
      changes.set('settings.json', { path: 'settings.json', content: json(useSettings.getState().settings) });
    } else if (kind === 'delete') {
      const entries = await tree();
      for (const e of entries) if (e.path === rest || e.path.startsWith(`${rest}/`)) changes.set(e.path, { path: e.path, delete: true });
      if (!message) message = `Remove: ${rest.replace(/^projects\//, '')}`;
    }
  }
  return { changes: [...changes.values()], message: message || 'Update library' };
}

/** Pull remote changes into IndexedDB, merging documents edited on both sides. */
export async function applyRemote(git: GitApi, head: Head, meta: SyncMeta): Promise<{ known: Record<string, string>; merged: boolean; changed: boolean }> {
  const tree = await git.getTree(head.treeSha);
  const known: Record<string, string> = {};
  for (const e of tree) known[e.path] = e.sha;
  const dirty = new Set((await db.syncQueue.toArray()).map((q) => q.key));
  const read = async (sha: string) => JSON.parse(utf8(await git.readBlob(sha)));
  let merged = false;
  let changed = false;
  const changedPaths = tree.filter((e) => meta.known[e.path] !== e.sha);

  // Projects first so documents can find them.
  for (const e of changedPaths) {
    const m = e.path.match(/^projects\/([^/]+)\/project\.json$/);
    if (!m) continue;
    const remote = (await read(e.sha)) as ProjectFile;
    const local = await db.projects.get(remote.id);
    if (!local || !dirty.has(`project:${remote.id}`) || remote.updatedAt > local.updatedAt) {
      await db.projects.put({ ...remote, openedAt: local?.openedAt ?? remote.openedAt });
      changed = true;
    }
  }
  for (const e of changedPaths) {
    let m = e.path.match(/^projects\/([^/]+)\/documents\/([^/]+)\.json$/);
    if (m) {
      const remote = (await read(e.sha)) as DocumentFile;
      const local = await db.documents.get(remote.id);
      if (!local || !dirty.has(`doc:${remote.id}`)) {
        await db.documents.put(remote);
      } else {
        await db.documents.put(mergeDocuments(local, remote, meta.lastSyncAt));
        await db.syncQueue.put({ key: `doc:${remote.id}`, at: Date.now() });
        merged = true;
      }
      changed = true;
      continue;
    }
    m = e.path.match(/^projects\/([^/]+)\/comments\/([^/]+)\.json$/);
    if (m) {
      const remote = (await read(e.sha)) as Comment[];
      const docId = m[2];
      if (!dirty.has(`comments:${docId}`)) {
        await db.comments.where('docId').equals(docId).delete();
        await db.comments.bulkPut(remote);
      } else {
        for (const c of remote) {
          const l = await db.comments.get(c.id);
          if (!l || c.updatedAt > l.updatedAt) await db.comments.put(c);
        }
      }
      changed = true;
      continue;
    }
    m = e.path.match(/^projects\/([^/]+)\/snapshots\.json$/);
    if (m) {
      const remote = (await read(e.sha)) as (Snapshot & { projectId?: string })[];
      const p = (await db.projects.toArray()).find((x) => x.path === m![1]);
      if (p) for (const s of remote) if (!(await db.snapshots.get(s.id))) await db.snapshots.put({ ...s, projectId: p.id });
      continue;
    }
    m = e.path.match(/^projects\/([^/]+)\/assets\/([^/.]+)\.(\w+)$/);
    if (m) {
      const p = (await db.projects.toArray()).find((x) => x.path === m![1]);
      if (p && !(await db.assets.get(m[2]))) {
        const bytes = await git.readBlob(e.sha);
        await db.assets.put({ id: m[2], projectId: p.id, name: m[2], type: `image/${m[3] === 'jpg' ? 'jpeg' : m[3]}`, data: bytes.buffer as ArrayBuffer });
      }
      continue;
    }
    if (e.path === 'settings.json' && !dirty.has('settings')) {
      const remote = (await read(e.sha)) as Settings;
      const local = useSettings.getState().settings;
      if (remote.updatedAt > local.updatedAt) {
        const s = mergeSettings(remote);
        await db.settings.put({ key: 'settings', value: s });
        useSettings.getState().replace(s);
      }
    }
    if (e.path === 'library.json' && !dirty.has('library')) {
      const remote = (await read(e.sha)) as LibraryFile;
      await db.settings.put({ key: 'folders', value: remote.folders ?? [] });
      changed = true;
    }
  }
  // Files that disappeared remotely were deleted on another device.
  for (const path of Object.keys(meta.known)) {
    if (known[path]) continue;
    let m = path.match(/^projects\/([^/]+)\/documents\/([^/]+)\.json$/);
    if (m && !dirty.has(`doc:${m[2]}`)) { await db.documents.delete(m[2]); changed = true; continue; }
    m = path.match(/^projects\/([^/]+)\/project\.json$/);
    if (m) {
      const p = (await db.projects.toArray()).find((x) => x.path === m![1]);
      if (!p) continue;
      const docs = await db.documents.where('projectId').equals(p.id).primaryKeys();
      if (docs.some((d) => dirty.has(`doc:${d}`))) {
        // Edited here after it was deleted elsewhere: keep it and write it back.
        await db.syncQueue.bulkPut([`project:${p.id}`, ...docs.map((d) => `doc:${d}`), 'library'].map((key) => ({ key, at: Date.now() })));
      } else {
        await db.documents.bulkDelete(docs);
        await db.projects.delete(p.id);
        changed = true;
      }
    }
  }
  return { known, merged, changed };
}

async function runOnce(message?: string): Promise<boolean> {
  const git = api;
  if (!git) { setStatus({ state: 'signedout' }); return false; }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { setStatus({ state: 'offline' }); return false; }
  setStatus({ state: 'pushing', error: undefined });
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      let head = await git.getHead();
      if (!head) {
        await git.bootstrap();
        head = await git.getHead();
        if (!head) throw new Error('Could not create the first commit');
      }
      let meta = await getMeta();
      if (head.sha !== meta.headSha) {
        const r = await applyRemote(git, head, meta);
        meta = { headSha: head.sha, known: r.known, lastSyncAt: meta.lastSyncAt };
        await putMeta(meta);
        if (r.merged) useApp.getState().toast('Merged changes from another device.');
        if (r.changed || r.merged) afterRemoteChange?.();
      }
      const items = await db.syncQueue.toArray();
      if (!items.length) {
        setStatus({ state: 'synced', lastOnline: new Date().toISOString(), lastCommitUrl: git.commitUrl(head.sha) });
        return true;
      }
      const headNow = head;
      const { changes, message: auto } = await buildChanges(items.map((i) => i.key), git, () => git.getTree(headNow.treeSha));
      if (changes.length) {
        const c = await git.commit(head, changes, message ?? auto);
        if (!(await git.updateRef(c.sha))) continue; // someone else pushed: pull, merge, retry
        const tree = await git.getTree(c.treeSha);
        const known: Record<string, string> = {};
        for (const e of tree) known[e.path] = e.sha;
        await putMeta({ headSha: c.sha, known, lastSyncAt: new Date().toISOString() });
        head = c;
      }
      for (const it of items) {
        const cur = await db.syncQueue.get(it.key);
        if (cur && cur.at <= it.at) await db.syncQueue.delete(it.key);
      }
      lastCommitAt = Date.now();
      const left = await db.syncQueue.count();
      setStatus({ state: left ? 'pending' : 'synced', lastOnline: new Date().toISOString(), lastCommitUrl: git.commitUrl(head.sha) });
      if (left) schedule();
      return true;
    }
    throw new Error('Could not push after several tries');
  } catch (e) {
    if (e instanceof AuthError) {
      setStatus({ state: 'signedout' });
      useApp.setState({ auth: { checked: true } });
      api = null;
    } else {
      setStatus({ state: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error', error: (e as Error).message });
    }
    return false;
  }
}

/** Commit and push now (Ctrl+S, snapshots, tab hidden). */
export function syncNow(message?: string): Promise<boolean> {
  if (timer) { clearTimeout(timer); timer = null; }
  if (message) pendingMessage = message;
  if (running) return running.then(() => syncNow());
  const msg = pendingMessage ?? undefined;
  pendingMessage = null;
  running = runOnce(msg).finally(() => { running = null; });
  return running;
}

/** Queue a commit: at most one every commit interval while writing. */
export function schedule() {
  if (!api) { void refreshPendingStatus(); return; }
  if (timer) return;
  const interval = (useSettings.getState().settings.misc.commitIntervalSec || 30) * 1000;
  const wait = Math.max(3000, lastCommitAt + interval - Date.now());
  void refreshPendingStatus();
  timer = setTimeout(() => { timer = null; void syncNow(); }, wait);
}

async function refreshPendingStatus() {
  const n = await db.syncQueue.count();
  const st = useApp.getState().sync.state;
  if (n && st !== 'pushing') setStatus({ state: api ? (navigator.onLine === false ? 'offline' : 'pending') : st === 'signedout' ? 'signedout' : 'offline' });
}

let started = false;
export function startSync() {
  if (started) return;
  started = true;
  onDirty(() => schedule());
  window.addEventListener('online', () => { void syncNow(); });
  window.addEventListener('offline', () => setStatus({ state: 'offline' }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (api) void db.syncQueue.count().then((n) => { if (n) void syncNow(); }); }
    else if (api) void syncNow();
  });
  // Check for changes from other devices now and then.
  setInterval(() => { if (api && document.visibilityState === 'visible' && !running) void syncNow(); }, 120_000);
}

/** For tests. */
export function resetSyncForTests() { api = null; running = null; if (timer) clearTimeout(timer); timer = null; lastCommitAt = 0; pendingMessage = null; }
