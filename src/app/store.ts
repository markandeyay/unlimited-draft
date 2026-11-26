import { create } from 'zustand';
import type { ElementType } from '../layout/geometry';
import type { DocumentFile, ProjectFile } from '../storage/models';

export type RailTab = 'project' | 'cards' | 'comments' | 'analysis' | 'tools' | 'account';

export type Route =
  | { name: 'library' }
  | { name: 'project'; projectId: string; docId?: string; lineId?: string };

export interface CursorInfo {
  type: ElementType;
  dual: boolean;
  page: number;
  total: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  lineId: string;
}

export interface SyncStatus {
  state: 'synced' | 'pending' | 'pushing' | 'offline' | 'signedout' | 'error';
  lastOnline?: string;
  lastOffline?: string;
  lastCommitUrl?: string;
  error?: string;
}

export interface ScreenFilter {
  label: string;
  /** Hide these element types. */
  hide?: ElementType[];
  /** Show only these line ids. */
  onlyIds?: string[];
}

export interface AppState {
  route: Route;
  project: ProjectFile | null;
  docs: DocumentFile[];
  activeDocId: string | null;
  rail: RailTab;
  panelOpen: boolean;
  sidebarHidden: boolean;
  toolbarOpen: boolean;
  menubarOpen: boolean;
  viewMode: 'page' | 'cards';
  fullscreen: boolean;
  dialog: { name: string; props?: any } | null;
  cursor: CursorInfo;
  /** Bumps whenever the open document is saved, so panels can refresh. */
  docVersion: number;
  hideShots: boolean;
  hideNotes: boolean;
  filter: ScreenFilter | null;
  sync: SyncStatus;
  auth: { checked: boolean; login?: string; avatar?: string };
  notice: string | null;
  libraryVersion: number;
  set: (p: Partial<AppState>) => void;
  openDialog: (name: string, props?: any) => void;
  closeDialog: () => void;
  toast: (msg: string) => void;
}

export const useApp = create<AppState>((set) => ({
  route: { name: 'library' },
  project: null,
  docs: [],
  activeDocId: null,
  rail: 'project',
  panelOpen: true,
  sidebarHidden: false,
  toolbarOpen: true,
  menubarOpen: true,
  viewMode: 'page',
  fullscreen: false,
  dialog: null,
  cursor: { type: 'action', dual: false, page: 1, total: 1, bold: false, italic: false, underline: false, strike: false, lineId: '' },
  docVersion: 0,
  hideShots: false,
  hideNotes: false,
  filter: null,
  sync: { state: 'signedout' },
  auth: { checked: false },
  notice: null,
  libraryVersion: 0,
  set: (p) => set(p),
  openDialog: (name, props) => set({ dialog: { name, props } }),
  closeDialog: () => set({ dialog: null }),
  toast: (msg) => {
    set({ notice: msg });
    setTimeout(() => { if (useApp.getState().notice === msg) set({ notice: null }); }, 4000);
  },
}));

export const activeDoc = (s: AppState = useApp.getState()): DocumentFile | undefined =>
  s.docs.find((d) => d.id === s.activeDocId);

// Tiny router on top of the History API.
export function parseRoute(path: string, search = ''): Route {
  const m = path.match(/^\/p\/([^/]+)(?:\/([^/]+))?/);
  if (!m) return { name: 'library' };
  const lineId = new URLSearchParams(search).get('line') ?? undefined;
  return { name: 'project', projectId: m[1], docId: m[2], lineId };
}

export function routePath(r: Route): string {
  if (r.name === 'library') return '/';
  return `/p/${r.projectId}${r.docId ? `/${r.docId}` : ''}${r.lineId ? `?line=${r.lineId}` : ''}`;
}

export function navigate(r: Route, replace = false) {
  const path = routePath(r);
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  useApp.setState({ route: r });
}
