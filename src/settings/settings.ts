import { create } from 'zustand';
import { DEFAULT_FLOW } from '../editor/flow';
import { A4, DEFAULT_ELEMENTS, ELEMENT_TYPES, LETTER, type ElementSpec, type ElementType, type PageGeometry, cloneGeometry } from '../layout/geometry';
import type { LayoutOptions } from '../layout/paginate';
import type { DocumentFile, DocumentSettings, Settings } from '../storage/models';

export const DEFAULT_AUTHOR = 'Markandeya Yalamanchi';

export function defaultElements(): Record<ElementType, ElementSpec> {
  const out = {} as Record<ElementType, ElementSpec>;
  for (const t of ELEMENT_TYPES) out[t] = { ...DEFAULT_ELEMENTS[t] };
  return out;
}

export function defaultSettings(): Settings {
  return {
    schema: 1,
    updatedAt: new Date(0).toISOString(),
    editing: {
      flow: JSON.parse(JSON.stringify(DEFAULT_FLOW)),
      autocomplete: true,
      autoCapitalize: true,
      smartQuotes: false,
      autoContd: true,
      spellCheck: true,
    },
    display: {
      darkMode: false,
      highlightCurrentLine: true,
      pageShadow: true,
      showPageBreaks: true,
      showPageCount: true,
      textSize: 1,
      zoom: 1,
    },
    format: { elements: defaultElements() },
    pdf: {
      includeTitlePage: true,
      authorName: DEFAULT_AUTHOR,
      address: '',
      phone: '',
      email: '',
      draftName: '',
      draftDate: '',
      sceneNumbers: 'both',
      revisionAsterisks: true,
      includeNotes: false,
    },
    page: {
      paper: 'letter',
      marginTopIn: 1,
      marginBottomIn: 1,
      marginLeftIn: 1.5,
      marginRightIn: 1,
      pageNumberPosition: 'top-right',
      firstPageNumbered: false,
    },
    production: { moreText: '(MORE)', contdText: "(CONT'D)", splitDialogue: true, splitAction: true, splitAtSentences: true },
    misc: { commitIntervalSec: 30 },
  };
}

export function defaultDocumentSettings(): DocumentSettings {
  return {
    header: { left: '', center: '', right: '' },
    footer: { left: '', center: '', right: '' },
    sceneContinueds: false,
    sceneNumberStart: 1,
    sceneNumberSide: 'both',
  };
}

/** Deep-merge stored settings over defaults so new fields always exist. */
export function mergeSettings(stored: unknown): Settings {
  const base = defaultSettings() as any;
  const merge = (a: any, b: any): any => {
    if (b === undefined || b === null) return a;
    if (typeof a !== 'object' || a === null || Array.isArray(a)) return b;
    const out: any = { ...a };
    for (const k of Object.keys(b)) out[k] = k in a ? merge(a[k], b[k]) : b[k];
    return out;
  };
  return merge(base, stored) as Settings;
}

interface SettingsStore {
  settings: Settings;
  loaded: boolean;
  set: (fn: (s: Settings) => void) => void;
  replace: (s: Settings) => void;
}

let persist: ((s: Settings) => void) | null = null;
export function setSettingsPersister(fn: (s: Settings) => void) { persist = fn; }

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: defaultSettings(),
  loaded: false,
  set: (fn) => {
    const next: Settings = JSON.parse(JSON.stringify(get().settings));
    fn(next);
    next.updatedAt = new Date().toISOString();
    set({ settings: next });
    persist?.(next);
  },
  replace: (s) => set({ settings: mergeSettings(s), loaded: true }),
}));

/** Build the page geometry from settings. Top/bottom margins change lines per page. */
export function geometryFromSettings(s: Settings): PageGeometry {
  const g = cloneGeometry(s.page.paper === 'a4' ? A4 : LETTER);
  for (const t of ELEMENT_TYPES) g.elements[t] = { ...g.elements[t], ...s.format.elements[t] };
  const shift = Math.round((s.page.marginLeftIn - 1.5) * 10);
  if (shift !== 0) {
    for (const t of ELEMENT_TYPES) g.elements[t].left += shift;
    g.dual.leftCol += shift;
    g.dual.rightCol += shift;
  }
  g.topPt = s.page.marginTopIn * 72;
  g.linesPerPage = Math.max(10, Math.floor((g.heightPt - g.topPt - s.page.marginBottomIn * 72) / g.linePt));
  g.pageNumberFirstPage = s.page.firstPageNumbered;
  return g;
}

/** WriterDuet centers title page text in a box 400 pt wide starting at the left margin (measured from its PDF). */
export const TITLE_PAGE_TEXT_WIDTH = 400 / 7.2;

export function geometryFor(s: Settings, kind?: DocumentFile['kind']): PageGeometry {
  const g = geometryFromSettings(s);
  if (kind === 'titlePage') g.elements.text = { ...g.elements.text, width: TITLE_PAGE_TEXT_WIDTH };
  return g;
}

export function layoutOptionsFor(s: Settings, doc?: Pick<DocumentFile, 'settings' | 'kind'>): Partial<LayoutOptions> {
  return {
    geometry: geometryFor(s, doc?.kind),
    autoContd: s.editing.autoContd && doc?.kind !== 'titlePage',
    moreText: s.production.moreText,
    contdText: s.production.contdText,
    splitDialogue: s.production.splitDialogue,
    splitAction: s.production.splitAction,
    splitAtSentences: s.production.splitAtSentences,
    sceneContinueds: !!doc?.settings.sceneContinueds,
  };
}
