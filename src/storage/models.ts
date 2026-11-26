import type { Align, ElementSpec, ElementType } from '../layout/geometry';

export type { ElementType, Align };

export type MarkKind = 'bold' | 'italic' | 'underline' | 'strike' | 'color' | 'highlight';

export interface InlineMark {
  from: number;
  to: number;
  kind: MarkKind;
  value?: string;
}

export interface Line {
  id: string;
  type: ElementType;
  text: string;
  marks?: InlineMark[];
  dual?: 'left' | 'right';
  sceneNumber?: string;
  omitted?: boolean;
  revisionColor?: string;
  revisionMarked?: boolean;
  imageRef?: string;
  align?: Align;
  pageBreakBefore?: boolean;
  bullet?: boolean;
  createdAt: string;
  updatedAt: string;
  /** Device that last changed the line (for Date & Writers). */
  device?: string;
  /** Older versions kept when two devices changed the same line. */
  history?: { text: string; type: ElementType; at: string }[];
}

export interface HeaderFooter { left: string; center: string; right: string }

export interface DocumentSettings {
  header: HeaderFooter;
  footer: HeaderFooter;
  sceneContinueds: boolean;
  sceneNumberStart: number;
  sceneNumberSide: 'left' | 'right' | 'both';
}

export interface RevisionState {
  tracking: boolean;
  color: string;
  /** Lines as they were when tracking started, by id. */
  base?: Record<string, { type: ElementType; text: string } | null>;
  baseOrder?: string[];
  startedAt?: string;
}

export type DocKind = 'script' | 'pad' | 'titlePage' | 'custom';

export interface DocumentFile {
  schema: 1;
  id: string;
  projectId: string;
  kind: DocKind;
  name: string;
  settings: DocumentSettings;
  lines: Line[];
  sceneNumbers: { enabled: boolean; locked: boolean };
  revision: RevisionState;
  updatedAt: string;
}

export interface ProjectFile {
  schema: 1;
  id: string;
  name: string;
  path: string;
  folderId?: string;
  createdAt: string;
  updatedAt: string;
  openedAt?: string;
  documentOrder: string[];
  pageCount: number;
}

export interface Folder { id: string; name: string; parentId?: string }

export interface LibraryFile {
  schema: 1;
  folders: Folder[];
  projects: {
    id: string; path: string; name: string; folderId?: string;
    pageCount: number; updatedAt: string; openedAt?: string; createdAt?: string;
  }[];
}

export interface Comment {
  id: string;
  docId: string;
  projectId: string;
  lineId: string;
  from?: number;
  to?: number;
  quote?: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  resolved: boolean;
}

export interface Snapshot { id: string; name: string; docId: string; sha?: string; at: string; lines?: Line[] }

export interface FlowRow { enter: ElementType; enterEmpty: ElementType; tab: ElementType }

export interface Settings {
  schema: 1;
  updatedAt: string;
  editing: {
    flow: Record<string, FlowRow>;
    autocomplete: boolean;
    autoCapitalize: boolean;
    smartQuotes: boolean;
    autoContd: boolean;
    spellCheck: boolean;
  };
  display: {
    darkMode: boolean;
    highlightCurrentLine: boolean;
    pageShadow: boolean;
    showPageBreaks: boolean;
    showPageCount: boolean;
    textSize: number;
    zoom: number;
  };
  format: { elements: Record<ElementType, ElementSpec> };
  pdf: {
    includeTitlePage: boolean;
    authorName: string;
    address: string;
    phone: string;
    email: string;
    draftName: string;
    draftDate: string;
    sceneNumbers: 'left' | 'right' | 'both';
    revisionAsterisks: boolean;
    includeNotes: boolean;
  };
  page: {
    paper: 'letter' | 'a4';
    marginTopIn: number;
    marginBottomIn: number;
    marginLeftIn: number;
    marginRightIn: number;
    pageNumberPosition: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-center' | 'none';
    firstPageNumbered: boolean;
  };
  production: { moreText: string; contdText: string; splitDialogue: boolean; splitAction: boolean; splitAtSentences: boolean };
  misc: { commitIntervalSec: number };
}
