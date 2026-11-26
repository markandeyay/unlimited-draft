import Dexie, { type Table } from 'dexie';
import { ulid } from 'ulid';
import { DEFAULT_AUTHOR, defaultDocumentSettings } from '../settings/settings';
import type { Comment, DocKind, DocumentFile, Folder, Line, ProjectFile, Settings, Snapshot } from './models';

export interface QueueItem { key: string; at: number }
export interface KV { key: string; value: any }
export interface AssetRow { id: string; projectId: string; name: string; type: string; data: Blob | ArrayBuffer }
export interface DeletedRow { id: string; path: string }

class UDDatabase extends Dexie {
  projects!: Table<ProjectFile & { deleted?: boolean }, string>;
  documents!: Table<DocumentFile, string>;
  comments!: Table<Comment, string>;
  assets!: Table<AssetRow, string>;
  syncQueue!: Table<QueueItem, string>;
  settings!: Table<KV, string>;
  searchIndex!: Table<KV, string>;
  historyCache!: Table<KV, string>;
  snapshots!: Table<Snapshot & { projectId: string }, string>;

  constructor() {
    super('unlimited-draft');
    this.version(1).stores({
      projects: 'id, updatedAt, folderId',
      documents: 'id, projectId',
      comments: 'id, docId, projectId',
      assets: 'id, projectId',
      syncQueue: 'key, at',
      settings: 'key',
      searchIndex: 'key',
      historyCache: 'key',
      snapshots: 'id, projectId, docId',
    });
  }
}

export const db = new UDDatabase();

export const newId = () => ulid();
export const nowIso = () => new Date().toISOString();

export function deviceName(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return 'iPhone/iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Mac/.test(ua)) return 'Mac';
  return 'Browser';
}

export function slugify(name: string): string {
  const s = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || 'untitled';
}

export function makeLine(type: Line['type'], text = '', extra: Partial<Line> = {}): Line {
  const at = nowIso();
  return { id: newId(), type, text, createdAt: at, updatedAt: at, ...extra };
}

/** Default title page. Rows measured from WriterDuet's PDF: title on line 17, "written by" on 21, author on 24. */
export function defaultTitlePageLines(title: string, s?: Settings['pdf']): Line[] {
  const lines: Line[] = [];
  const blank = (n: number) => { for (let i = 0; i < n; i++) lines.push(makeLine('text', '')); };
  blank(17);
  lines.push(makeLine('text', title.toUpperCase(), { align: 'center' }));
  blank(3);
  lines.push(makeLine('text', 'written by', { align: 'center' }));
  blank(2);
  lines.push(makeLine('text', s?.authorName || DEFAULT_AUTHOR, { align: 'center' }));
  const contact = [s?.address, s?.phone, s?.email].filter(Boolean) as string[];
  const draft = [s?.draftName, s?.draftDate].filter(Boolean) as string[];
  if (contact.length || draft.length) {
    const rows = Math.max(contact.length, draft.length);
    blank(54 - lines.length - rows - 2);
    for (const c of contact) lines.push(makeLine('text', c));
    if (draft.length && !contact.length) for (const d of draft) lines.push(makeLine('text', d, { align: 'right' }));
  }
  return lines;
}

function makeDoc(projectId: string, kind: DocKind, name: string, lines: Line[]): DocumentFile {
  return {
    schema: 1, id: newId(), projectId, kind, name, settings: defaultDocumentSettings(), lines,
    sceneNumbers: { enabled: false, locked: false }, revision: { tracking: false, color: 'Blue' }, updatedAt: nowIso(),
  };
}

export async function markDirty(...keys: string[]) {
  const at = Date.now();
  await db.syncQueue.bulkPut(keys.map((key) => ({ key, at })));
  dirtyListeners.forEach((fn) => fn());
}
const dirtyListeners = new Set<() => void>();
export function onDirty(fn: () => void) { dirtyListeners.add(fn); return () => dirtyListeners.delete(fn); }

export async function createProject(name: string, opts: { folderId?: string; lines?: Line[]; pdf?: Settings['pdf']; extraDocs?: { name: string; lines: Line[] }[] } = {}): Promise<ProjectFile> {
  const id = newId();
  const at = nowIso();
  const script = makeDoc(id, 'script', 'Script', opts.lines?.length ? opts.lines : [makeLine('action', '')]);
  const pad = makeDoc(id, 'pad', 'Private Pad', [makeLine('text', '')]);
  const title = makeDoc(id, 'titlePage', 'Title Page', defaultTitlePageLines(name, opts.pdf));
  const extra = (opts.extraDocs ?? []).map((d) => makeDoc(id, 'custom', d.name, d.lines));
  const project: ProjectFile = {
    schema: 1, id, name, path: `${slugify(name)}-${id.slice(-6).toLowerCase()}`, folderId: opts.folderId,
    createdAt: at, updatedAt: at, openedAt: at, documentOrder: [script.id, pad.id, title.id, ...extra.map((d) => d.id)], pageCount: 1,
  };
  await db.transaction('rw', db.projects, db.documents, db.syncQueue, async () => {
    await db.projects.put(project);
    await db.documents.bulkPut([script, pad, title, ...extra]);
  });
  await markDirty(`project:${id}`, ...project.documentOrder.map((d) => `doc:${d}`), 'library');
  return project;
}

export async function listProjects(): Promise<ProjectFile[]> {
  return (await db.projects.toArray()).filter((p) => !p.deleted);
}

export const getProject = (id: string) => db.projects.get(id);
export const getDocument = (id: string) => db.documents.get(id);

export async function getDocuments(projectId: string): Promise<DocumentFile[]> {
  const [p, docs] = await Promise.all([db.projects.get(projectId), db.documents.where('projectId').equals(projectId).toArray()]);
  const order = p?.documentOrder ?? [];
  return docs.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

export async function saveDocument(doc: DocumentFile, pageCount?: number) {
  doc.updatedAt = nowIso();
  await db.documents.put(doc);
  const p = await db.projects.get(doc.projectId);
  const keys = [`doc:${doc.id}`];
  if (p) {
    p.updatedAt = doc.updatedAt;
    if (pageCount !== undefined && doc.kind === 'script') p.pageCount = pageCount;
    await db.projects.put(p);
    keys.push(`project:${p.id}`, 'library');
  }
  await markDirty(...keys);
}

export async function updateProject(id: string, fn: (p: ProjectFile) => void, touch = true) {
  const p = await db.projects.get(id);
  if (!p) return;
  fn(p);
  if (touch) p.updatedAt = nowIso();
  await db.projects.put(p);
  await markDirty(`project:${id}`, 'library');
}

export async function touchOpened(id: string) {
  const p = await db.projects.get(id);
  if (!p) return;
  p.openedAt = nowIso();
  await db.projects.put(p);
  await markDirty('library');
}

export async function renameProject(id: string, name: string) {
  await updateProject(id, (p) => { p.name = name; });
}

export async function duplicateProject(id: string, name?: string): Promise<ProjectFile | undefined> {
  const p = await db.projects.get(id);
  if (!p) return;
  const docs = await getDocuments(id);
  const nid = newId();
  const at = nowIso();
  const copies = docs.map((d) => ({
    ...structuredClone(d), id: newId(), projectId: nid,
    lines: d.lines.map((l) => ({ ...l, id: newId() })),
    revision: { tracking: false, color: d.revision.color },
  }));
  const nname = name ?? `${p.name} (copy)`;
  const np: ProjectFile = {
    ...p, id: nid, name: nname, path: `${slugify(nname)}-${nid.slice(-6).toLowerCase()}`,
    createdAt: at, updatedAt: at, openedAt: at, documentOrder: copies.map((c) => c.id),
  };
  await db.projects.put(np);
  await db.documents.bulkPut(copies);
  await markDirty(`project:${nid}`, ...copies.map((c) => `doc:${c.id}`), 'library');
  return np;
}

export async function removeProject(id: string) {
  const p = await db.projects.get(id);
  if (!p) return;
  const docs = await db.documents.where('projectId').equals(id).primaryKeys();
  await db.documents.bulkDelete(docs);
  await db.comments.where('projectId').equals(id).delete();
  await db.assets.where('projectId').equals(id).delete();
  await db.snapshots.where('projectId').equals(id).delete();
  await db.projects.delete(id);
  await markDirty(`delete:projects/${p.path}`, 'library');
}

export async function addDocument(projectId: string, name: string, lines?: Line[]): Promise<DocumentFile> {
  const doc = makeDoc(projectId, 'custom', name, lines ?? [makeLine('action', '')]);
  await db.documents.put(doc);
  await updateProject(projectId, (p) => { p.documentOrder.push(doc.id); });
  await markDirty(`doc:${doc.id}`);
  return doc;
}

export async function removeDocument(doc: DocumentFile) {
  const p = await db.projects.get(doc.projectId);
  await db.documents.delete(doc.id);
  await db.comments.where('docId').equals(doc.id).delete();
  if (p) {
    await updateProject(p.id, (x) => { x.documentOrder = x.documentOrder.filter((d) => d !== doc.id); });
    await markDirty(`delete:projects/${p.path}/documents/${doc.id}.json`, `delete:projects/${p.path}/documents/${doc.id}.fountain`, `delete:projects/${p.path}/comments/${doc.id}.json`);
  }
}

// Folders live in the settings table under one key.
export async function getFolders(): Promise<Folder[]> {
  return (await db.settings.get('folders'))?.value ?? [];
}
export async function saveFolders(folders: Folder[]) {
  await db.settings.put({ key: 'folders', value: folders });
  await markDirty('library');
}

export async function loadSettings(): Promise<Settings | undefined> {
  return (await db.settings.get('settings'))?.value;
}
export async function saveSettings(s: Settings, dirty = true) {
  await db.settings.put({ key: 'settings', value: s });
  if (dirty) await markDirty('settings');
}

export async function listComments(docId: string): Promise<Comment[]> {
  return (await db.comments.where('docId').equals(docId).toArray()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function putComment(c: Comment) {
  c.updatedAt = nowIso();
  await db.comments.put(c);
  await markDirty(`comments:${c.docId}`);
}
export async function deleteComment(c: Comment) {
  await db.comments.delete(c.id);
  await markDirty(`comments:${c.docId}`);
}

export async function clearLocalCache() {
  await Promise.all([db.searchIndex.clear(), db.historyCache.clear()]);
}
