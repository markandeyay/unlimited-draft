// Every menu, panel and shortcut action in one place.
import { selectAll } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import { closeProject, newProject, openProject, refreshProject, switchDocument, updateActiveDoc } from '../app/project';
import { activeDoc, useApp } from '../app/store';
import * as cmd from '../editor/commands';
import { exec, flushEditor, getView } from '../editor/controller';
import type { ElementType } from '../layout/geometry';
import { type PdfOptions, defaultPdfOptions, downloadBytes, pdfFileName } from '../pdf/util';
import { useSettings } from '../settings/settings';
import * as store from '../storage/db';
import type { DocumentFile } from '../storage/models';
import { syncNow } from '../sync/engine';

const app = () => useApp.getState();
const settings = () => useSettings.getState().settings;

/** Promise-based prompt and confirm built on the dialog host. */
export function ask(title: string, opts: { label?: string; value?: string; confirmText?: string; message?: string; danger?: boolean; input?: boolean } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    app().openDialog('prompt', { title, ...opts, input: opts.input ?? true, resolve });
  });
}
export const confirmDialog = (title: string, message: string, confirmText = 'OK', danger = false) =>
  ask(title, { message, confirmText, danger, input: false }).then((v) => v !== null);

async function currentScript(): Promise<{ script: DocumentFile; titlePage?: DocumentFile } | null> {
  await flushEditor();
  const s = app();
  if (!s.project) return null;
  const docs = await store.getDocuments(s.project.id);
  const active = docs.find((d) => d.id === s.activeDocId);
  const script = active && active.kind !== 'titlePage' ? active : docs.find((d) => d.kind === 'script');
  if (!script) return null;
  return { script, titlePage: docs.find((d) => d.kind === 'titlePage') };
}

async function loadImages(doc: DocumentFile) {
  const out = new Map<string, { bytes: Uint8Array; type: string }>();
  for (const l of doc.lines) {
    if (l.type !== 'image' || !l.imageRef) continue;
    const a = await store.db.assets.get(l.imageRef);
    if (!a) continue;
    const buf = a.data instanceof Blob ? await a.data.arrayBuffer() : a.data;
    out.set(l.imageRef, { bytes: new Uint8Array(buf), type: a.type });
  }
  return out;
}

export async function makePdf(overrides: Partial<PdfOptions> = {}): Promise<{ bytes: Uint8Array; name: string } | null> {
  const cur = await currentScript();
  const s = app();
  if (!cur || !s.project) return null;
  const st = settings();
  const options: PdfOptions = { ...defaultPdfOptions(st, cur.script), hideShots: s.hideShots, ...overrides };
  if (options.includeNotes && !options.comments) options.comments = await store.listComments(cur.script.id);
  const { buildPdf } = await import('../pdf/export');
  const bytes = await buildPdf({
    title: s.project.name, script: cur.script, titlePage: cur.titlePage, settings: st, options, images: await loadImages(cur.script),
  });
  return { bytes, name: pdfFileName(s.project.name, st) };
}

async function sharePdf(bytes: Uint8Array, name: string, title: string): Promise<boolean> {
  try {
    const file = new File([bytes as BlobPart], name, { type: 'application/pdf' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return true;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return true;
  }
  return false;
}

export const actions = {
  // File
  newProject: async () => {
    const name = await ask('New Project', { label: 'Project name', value: 'Untitled Project', confirmText: 'Create' });
    if (name !== null) await newProject(name.trim() || 'Untitled Project');
  },
  openLibrary: () => closeProject(),
  openRecent: (id: string) => openProject(id),
  saveProject: async () => {
    await flushEditor();
    const ok = await syncNow();
    app().toast(ok ? 'Saved and synced.' : 'Saved on this device. Sync will finish when you are online and signed in.');
  },
  externalBackups: () => app().openDialog('backups'),
  renameProject: async () => {
    const p = app().project;
    if (!p) return;
    const name = await ask('Rename Project', { label: 'Project name', value: p.name, confirmText: 'Rename' });
    if (name && name.trim()) { await store.renameProject(p.id, name.trim()); await refreshProject(); }
  },
  duplicateProject: async () => {
    const p = app().project;
    if (!p) return;
    const name = await ask('Duplicate Project', { label: 'Name of the copy', value: `${p.name} (copy)`, confirmText: 'Duplicate' });
    if (name === null) return;
    await flushEditor();
    const np = await store.duplicateProject(p.id, name.trim() || `${p.name} (copy)`);
    if (np) await openProject(np.id);
  },
  removeProject: async () => {
    const p = app().project;
    if (!p) return;
    if (!(await confirmDialog('Remove Project', `Remove "${p.name}"? It is deleted from this device and from the scripts repo. Earlier versions stay in the repo history.`, 'Remove', true))) return;
    await store.removeProject(p.id);
    await closeProject();
  },
  importFile: () => app().openDialog('import'),
  exportDialog: () => app().openDialog('export'),
  quickExport: async () => {
    const r = await makePdf();
    if (!r) return;
    if (window.innerWidth < 768 && (await sharePdf(r.bytes, r.name, app().project?.name ?? ''))) return;
    downloadBytes(r.bytes, r.name);
  },
  preview: async () => {
    const r = await makePdf();
    if (!r) return;
    const url = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: 'application/pdf' }));
    window.open(url, '_blank');
  },
  print: async () => {
    const r = await makePdf();
    if (!r) return;
    const url = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: 'application/pdf' }));
    const w = window.open(url, '_blank');
    if (w) w.addEventListener('load', () => setTimeout(() => { try { w.print(); } catch { /* viewer handles printing */ } }, 400));
  },
  closeTab: () => closeProject(),
  closeOtherTabs: () => app().toast('No other tabs are open.'),

  // Edit
  undo: () => exec(undo),
  redo: () => exec(redo),
  moveUp: () => exec(cmd.moveSelection(-1)),
  moveDown: () => exec(cmd.moveSelection(1)),
  insertPageBreak: () => exec(cmd.togglePageBreak),
  insertScene: () => exec(cmd.insertElement('scene')),
  insertImage: () => app().openDialog('insertImage'),
  insertActBreak: () => exec(cmd.insertElement('newAct')),
  insertSequence: () => exec(cmd.insertElement('sequence')),
  selectAll: () => exec(selectAll),
  find: () => app().openDialog('find'),
  filter: () => app().openDialog('filter'),
  goTo: () => app().openDialog('goto'),

  // Format
  setType: (t: ElementType) => {
    if (t === 'image') { app().openDialog('insertImage'); return; }
    if (t === 'newAct' || t === 'endAct') { exec(cmd.insertElement(t)); return; }
    exec(cmd.setLineType(t));
  },
  dual: () => exec(cmd.dualDialogue),
  exitDual: () => exec(cmd.exitDual),
  bold: () => exec(cmd.toggleBold),
  italic: () => exec(cmd.toggleItalic),
  underline: () => exec(cmd.toggleUnderline),
  strike: () => exec(cmd.toggleStrike),
  color: (v: string | null) => exec(cmd.setValueMark('color', v)),
  highlight: (v: string | null) => exec(cmd.setValueMark('highlight', v)),
  align: (a: 'left' | 'center' | 'right') => exec(cmd.setAlign(a)),
  bullets: () => exec(cmd.toggleBullet),

  // Share
  emailDocument: async () => {
    const r = await makePdf();
    const p = app().project;
    if (!r || !p) return;
    if (await sharePdf(r.bytes, r.name, p.name)) return;
    downloadBytes(r.bytes, r.name);
    location.href = `mailto:?subject=${encodeURIComponent(p.name)}&body=${encodeURIComponent(`Attached: ${r.name} (downloaded to your device, please attach it).`)}`;
  },

  // View
  pageView: () => app().set({ viewMode: 'page' }),
  cardView: async () => { await flushEditor(); app().set({ viewMode: 'cards' }); },
  fullScreen: async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { /* not allowed */ }
  },
  toggleDark: () => useSettings.getState().set((s) => { s.display.darkMode = !s.display.darkMode; }),
  togglePageBreaks: () => useSettings.getState().set((s) => { s.display.showPageBreaks = !s.display.showPageBreaks; }),
  togglePageCount: () => useSettings.getState().set((s) => { s.display.showPageCount = !s.display.showPageCount; }),
  toggleOutline: () => {
    const f = app().filter;
    if (f?.label === 'Outline hidden') app().set({ filter: null });
    else app().set({ filter: { label: 'Outline hidden', hide: ['outline', 'sequence'] } });
  },
  textSize: (n: number) => useSettings.getState().set((s) => { s.display.textSize = n; }),
  zoom: (n: number) => useSettings.getState().set((s) => { s.display.zoom = n; }),
  customize: (tab = 'Editing') => app().openDialog('customize', { tab }),

  // Tools
  comments: () => app().set({ rail: 'comments', panelOpen: true, sidebarHidden: false }),
  spelling: () => app().openDialog('spelling'),
  renameCharacter: () => app().openDialog('renameCharacter'),
  wordCount: () => app().openDialog('wordCount'),

  // Reports
  report: (kind: string) => app().openDialog('report', { kind }),
  pdfWithNotes: async () => {
    const r = await makePdf({ includeNotes: true });
    if (r) downloadBytes(r.bytes, r.name.replace(/\.pdf$/, ' (notes).pdf'));
  },
  toggleHideShots: () => app().set({ hideShots: !app().hideShots }),
  toggleHideNotes: () => app().set({ hideNotes: !app().hideNotes }),
  clearFilter: () => app().set({ filter: null }),

  // Revisions
  lineHistory: () => app().openDialog('lineHistory', { lineId: app().cursor.lineId }),
  viewTrack: () => app().openDialog('viewTrack'),
  acceptReject: () => app().openDialog('acceptReject'),
  dateWriters: () => app().openDialog('dateWriters'),
  markChange: () => exec(cmd.setAttrOnSelection('revisionMarked', true)),
  unmarkChange: () => {
    const v = getView();
    if (!v) return;
    const tr = v.state.tr;
    for (const { node, pos } of cmd.selectedNodes(v.state)) tr.setNodeMarkup(pos, null, { ...node.attrs, revisionMarked: false, revisionColor: null });
    v.dispatch(tr.setMeta('noTrack', true));
    v.focus();
  },
  timeline: () => app().openDialog('timeline'),
  saveSnapshot: () => app().openDialog('saveSnapshot'),
  snapshots: () => app().openDialog('snapshots'),

  // Production
  sceneNumbers: () => app().openDialog('sceneNumbers'),
  headersFooters: () => app().openDialog('headersFooters'),
  mores: () => app().openDialog('mores'),
  separateScene: () => exec(cmd.separateScene),
  omitScene: () => exec(cmd.omitScene),

  // Help
  shortcuts: () => app().openDialog('shortcuts'),
  about: () => app().openDialog('about'),

  // Documents
  switchDocument: (id: string) => switchDocument(id),
  addDocument: async () => {
    const p = app().project;
    if (!p) return;
    const name = await ask('Add Document', { label: 'Document name', value: 'New Document', confirmText: 'Add' });
    if (name === null) return;
    const d = await store.addDocument(p.id, name.trim() || 'New Document');
    await switchDocument(d.id);
  },
  renameDocument: async (d: DocumentFile) => {
    const name = await ask('Rename Document', { label: 'Document name', value: d.name, confirmText: 'Rename' });
    if (!name?.trim()) return;
    if (d.id === app().activeDocId) await updateActiveDoc((x) => { x.name = name.trim(); });
    else { const fresh = await store.getDocument(d.id); if (fresh) { fresh.name = name.trim(); await store.saveDocument(fresh); } await refreshProject(); }
  },
  removeDocument: async (d: DocumentFile) => {
    if (d.kind !== 'custom') { app().toast('The Script, Private Pad and Title Page cannot be removed.'); return; }
    if (!(await confirmDialog('Remove Document', `Remove "${d.name}"?`, 'Remove', true))) return;
    const s = app();
    if (s.activeDocId === d.id) await switchDocument(s.docs.find((x) => x.kind === 'script')!.id);
    await store.removeDocument(d);
    await refreshProject();
  },
  titlePage: () => {
    const d = app().docs.find((x) => x.kind === 'titlePage');
    if (d) void switchDocument(d.id);
  },
  backToScript: () => {
    const d = app().docs.find((x) => x.kind === 'script');
    if (d) void switchDocument(d.id);
  },
};

export type Actions = typeof actions;
export { activeDoc };
