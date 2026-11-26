// Opening, switching and updating the project in the app store.
import { flushEditor } from '../editor/controller';
import { useSettings } from '../settings/settings';
import * as store from '../storage/db';
import type { DocumentFile, Line } from '../storage/models';
import { navigate, useApp } from './store';

export async function openProject(projectId: string, docId?: string, lineId?: string): Promise<boolean> {
  await flushEditor();
  const project = await store.getProject(projectId);
  if (!project) return false;
  const docs = await store.getDocuments(projectId);
  if (!docs.length) return false;
  const active = docs.find((d) => d.id === docId) ?? docs.find((d) => d.kind === 'script') ?? docs[0];
  useApp.setState({ project, docs, activeDocId: active.id, filter: null, viewMode: 'page', docVersion: 0 });
  navigate({ name: 'project', projectId, docId: active.id, lineId }, true);
  void store.touchOpened(projectId);
  return true;
}

export async function switchDocument(docId: string, lineId?: string) {
  await flushEditor();
  const s = useApp.getState();
  if (!s.project) return;
  const fresh = await store.getDocuments(s.project.id);
  useApp.setState({ docs: fresh, activeDocId: docId, filter: null, viewMode: 'page' });
  navigate({ name: 'project', projectId: s.project.id, docId, lineId }, true);
}

export async function closeProject() {
  await flushEditor();
  useApp.setState({ project: null, docs: [], activeDocId: null, filter: null });
  navigate({ name: 'library' });
  useApp.setState((s) => ({ libraryVersion: s.libraryVersion + 1 }));
}

export async function newProject(name = 'Untitled Project', lines?: Line[], folderId?: string) {
  const p = await store.createProject(name, { lines, folderId, pdf: useSettings.getState().settings.pdf });
  await openProject(p.id);
  return p;
}

/** Change the open document's metadata safely (flushes edits first so lines are current). */
export async function updateActiveDoc(fn: (d: DocumentFile) => void, opts: { reload?: boolean } = {}) {
  await flushEditor();
  const s = useApp.getState();
  const cur = s.docs.find((d) => d.id === s.activeDocId);
  if (!cur) return;
  const next: DocumentFile = { ...cur, settings: { ...cur.settings, header: { ...cur.settings.header }, footer: { ...cur.settings.footer } }, sceneNumbers: { ...cur.sceneNumbers }, revision: { ...cur.revision } };
  fn(next);
  await store.saveDocument(next);
  useApp.setState((st) => ({
    docs: st.docs.map((d) => (d.id === next.id ? next : d)),
    docVersion: st.docVersion + 1,
    // Changing the id forces the editor to remount with the new lines.
    activeDocId: opts.reload ? null : st.activeDocId,
  }));
  if (opts.reload) setTimeout(() => useApp.setState({ activeDocId: next.id }), 0);
}

export async function refreshProject() {
  const s = useApp.getState();
  if (!s.project) return;
  const [project, docs] = await Promise.all([store.getProject(s.project.id), store.getDocuments(s.project.id)]);
  if (project) useApp.setState({ project, docs });
}
