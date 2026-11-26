import { elType } from './schema';
// Turns layout engine output into ProseMirror decorations:
// soft line wraps, page gaps, page numbers, (MORE) / (CONT'D), scene numbers, revision asterisks.
import type { Node as PMNode } from 'prosemirror-model';
import { type EditorState, Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { ElementType } from '../layout/geometry';
import { type BreakInfo, type LayoutLine, type LayoutOptions, type LayoutResult, type LineInfo, createLayoutEngine } from '../layout/paginate';

export interface LayoutPluginOptions {
  layout: Partial<LayoutOptions>;
  showPageBreaks: boolean;
  /** Scene numbers by line id, or null when off. */
  sceneNumbers: Map<string, string> | null;
  sceneNumberSide: 'left' | 'right' | 'both';
  /** Types hidden on screen (Hide All Shots, Hide Inline Notes, filters). */
  hide: ReadonlySet<ElementType>;
  /** When set, only these line ids are shown (Filter / report filters). */
  onlyIds: ReadonlySet<string> | null;
  numberFirstPage: boolean;
  /** Always take line breaks from the engine (title page). */
  explicitWraps: boolean;
  /** Scene headings whose content is collapsed on screen. */
  collapsed: ReadonlySet<string>;
  onToggleFold?: (lineId: string) => void;
}

export interface LayoutPluginState {
  result: LayoutResult;
  decos: DecorationSet;
  sigs: Map<string, string>;
  options: LayoutPluginOptions;
  pageCount: number;
  lastUsed: number;
}

export const layoutKey = new PluginKey<LayoutPluginState>('layout');

export const defaultLayoutPluginOptions = (): LayoutPluginOptions => ({
  layout: {}, showPageBreaks: true, sceneNumbers: null, sceneNumberSide: 'both', hide: new Set(), onlyIds: null, numberFirstPage: false, explicitWraps: false, collapsed: new Set(),
});

const lineCache = new WeakMap<PMNode, LayoutLine>();

function toLayoutLine(node: PMNode): LayoutLine {
  let l = lineCache.get(node);
  if (!l) {
    const a = node.attrs;
    l = { id: a.id, type: elType(node), text: node.textContent };
    if (a.dual) l.dual = a.dual;
    if (a.pageBreakBefore) l.pageBreakBefore = true;
    if (a.omitted) l.omitted = true;
    if (a.align) l.align = a.align;
    lineCache.set(node, l);
  }
  return l;
}

function pbDom(b: BreakInfo, inline: boolean, numberFirst: boolean): HTMLElement {
  const mk = (cls: string, text?: string) => {
    const s = document.createElement('span');
    s.className = cls;
    if (text) s.textContent = text;
    return s;
  };
  const el = mk(`pb${inline ? ' pb-inline' : ''}`);
  el.setAttribute('data-page', String(b.page + 1));
  const fill = mk('pb-fill');
  fill.style.height = `${b.filler * 16 + 96}px`;
  if (b.more) fill.appendChild(mk('pb-more', '(MORE)'));
  const top = mk('pb-top');
  if (b.page > 0 || numberFirst) top.appendChild(mk('pb-num', `${b.page + 1}.`));
  if (b.contdName) top.appendChild(mk('pb-contd', b.contdName));
  el.append(fill, mk('pb-gap'), top);
  return el;
}

/**
 * Lines made only of plain words wrap the same way in the browser as in the engine, so they need no
 * decorations. Text with other break opportunities (a hyphen or slash inside a word, non-ASCII
 * punctuation) gets explicit line breaks from the engine instead.
 */
const UNSAFE_WRAP = /[^\x20-\x7E]|[-/|?!][^\s\d?!.,:;'")\]-]/;
const unsafeCache = new WeakMap<PMNode, boolean>();
function unsafeWrap(node: PMNode, o: LayoutPluginOptions): boolean {
  if (o.explicitWraps) return true;
  let u = unsafeCache.get(node);
  if (u === undefined) {
    // Centered and right-aligned lines sit in a wider box than their character count, so they also need explicit breaks.
    u = UNSAFE_WRAP.test(node.textContent) || !!node.attrs.align || (!!node.attrs.dual && node.type.name === 'character');
    unsafeCache.set(node, u);
  }
  if (u) return true;
  const align = o.layout.geometry?.elements[elType(node)]?.align;
  return align !== undefined && align !== 'left';
}

function signature(li: LineInfo | undefined, sn: string | undefined, side: string, rev: boolean, pb: boolean, unsafe: boolean, fold = ''): string {
  if (!li) return 'hidden';
  let s = `${fold}|${li.spaceBefore}|${li.contd ? 1 : 0}|${unsafe ? li.wraps.join(',') : ''}|${sn ?? ''}${sn ? side : ''}|${rev ? 1 : 0}`;
  if (pb) {
    if (li.breakBefore) s += `|B${li.breakBefore.page},${li.breakBefore.filler},${li.breakBefore.more ? 1 : 0},${li.breakBefore.contdName ?? ''}`;
    for (const sp of li.splits) s += `|S${sp.offset},${sp.page},${sp.filler},${sp.more ? 1 : 0},${sp.contdName ?? ''}`;
  }
  return s;
}

function decosFor(pos: number, node: PMNode, li: LineInfo | undefined, o: LayoutPluginOptions): Decoration[] {
  const id = node.attrs.id as string;
  const end = pos + node.nodeSize;
  if (!li) return [Decoration.node(pos, end, { class: 'el-hidden' }, { id })];
  const out: Decoration[] = [];
  const unsafe = unsafeWrap(node, o) && li.wraps.length > 0;
  // Default spacing comes from CSS; a node decoration is only needed for exceptions.
  const def = o.layout.geometry?.elements[elType(node)]?.spaceBefore ?? -1;
  let cls = li.spaceBefore !== def ? `sb${li.spaceBefore}` : '';
  if (li.contd) cls += ' contd';
  if (unsafe) cls += ' nw';
  const isScene = node.type.name === 'scene';
  const isFolded = isScene && o.collapsed.has(id);
  if (isFolded) cls += ' folded';
  const attrs: Record<string, string> = {};
  if (cls) attrs.class = cls.trim();
  const sn = o.sceneNumbers?.get(id);
  if (sn && node.type.name === 'scene') {
    if (o.sceneNumberSide !== 'right') attrs['data-snl'] = sn;
    if (o.sceneNumberSide !== 'left') attrs['data-snr'] = sn;
  }
  if (cls || sn) out.push(Decoration.node(pos, end, attrs, { id }));
  if (isScene) {
    out.push(Decoration.widget(pos + 1, () => {
      const s = document.createElement('span');
      s.className = 'fold';
      s.textContent = isFolded ? '\u25b8' : '\u25be';
      s.title = isFolded ? 'Expand scene' : 'Collapse scene';
      s.setAttribute('data-testid', 'fold');
      s.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); o.onToggleFold?.(id); });
      return s;
    }, { id, side: -3, key: `fold-${id}-${isFolded ? 1 : 0}`, ignoreSelection: true, stopEvent: () => true }));
  }
  if (node.attrs.revisionMarked) {
    out.push(Decoration.widget(pos + 1, () => {
      const s = document.createElement('span');
      s.className = 'rev-mark';
      s.textContent = '*';
      return s;
    }, { id, side: -2, key: `rev-${id}`, ignoreSelection: true }));
  }
  if (o.showPageBreaks && li.breakBefore) {
    const b = li.breakBefore;
    out.push(Decoration.widget(pos, () => pbDom(b, false, o.numberFirstPage), {
      id, side: -1, key: `pb-${id}-${b.page}-${b.filler}-${b.more ? 1 : 0}-${b.contdName ?? ''}`, ignoreSelection: true,
    }));
  }
  const splitAt = new Map(o.showPageBreaks ? li.splits.map((s) => [s.offset, s]) : []);
  for (const off of li.wraps) {
    const sp = splitAt.get(off);
    if (sp) {
      out.push(Decoration.widget(pos + 1 + off, () => pbDom(sp, true, o.numberFirstPage), {
        id, side: -1, key: `sp-${id}-${off}-${sp.page}-${sp.filler}-${sp.contdName ?? ''}`, ignoreSelection: true,
      }));
    } else if (unsafe) {
      out.push(Decoration.widget(pos + 1 + off, () => {
        const br = document.createElement('br');
        br.className = 'wr';
        return br;
      }, { id, side: -1, key: `wr-${id}-${off}`, ignoreSelection: true }));
    }
  }
  return out;
}

function endDeco(doc: PMNode, result: LayoutResult, lines: number): Decoration {
  const last = result.pages[result.pages.length - 1];
  const filler = Math.max(0, lines - last.usedRows);
  return Decoration.widget(doc.content.size, () => {
    const s = document.createElement('div');
    s.className = 'pb-end';
    s.style.height = `${filler * 16}px`;
    return s;
  }, { id: '__end', side: 1, key: `end-${filler}` });
}

export function createLayoutPlugin(initial: LayoutPluginOptions) {
  const engine = createLayoutEngine();

  function run(doc: PMNode, o: LayoutPluginOptions): { result: LayoutResult; linesPerPage: number } {
    const lines: LayoutLine[] = [];
    let folded = false;
    doc.forEach((node) => {
      const l = toLayoutLine(node);
      // A collapsed scene keeps its heading and hides everything up to the next heading.
      if (l.type === 'scene') folded = o.collapsed.has(l.id);
      else if (folded) return;
      if (o.onlyIds && !o.onlyIds.has(l.id)) return;
      lines.push(l);
    });
    const layout: Partial<LayoutOptions> = { ...o.layout, hide: o.hide };
    if (!o.showPageBreaks && layout.geometry) layout.geometry = { ...layout.geometry, linesPerPage: 1e9 };
    const result = engine.layout(lines, layout);
    return { result, linesPerPage: layout.geometry?.linesPerPage ?? 54 };
  }

  function build(doc: PMNode, o: LayoutPluginOptions): LayoutPluginState {
    const { result, linesPerPage } = run(doc, o);
    const decos: Decoration[] = [];
    const sigs = new Map<string, string>();
    doc.forEach((node, pos) => {
      const id = node.attrs.id as string;
      const li = result.info.get(id);
      sigs.set(id, signature(li, o.sceneNumbers?.get(id), o.sceneNumberSide, node.attrs.revisionMarked, o.showPageBreaks, unsafeWrap(node, o), node.type.name === 'scene' ? (o.collapsed.has(id) ? 'F' : 'f') : ''));
      for (const d of decosFor(pos, node, li, o)) decos.push(d);
    });
    if (o.showPageBreaks) decos.push(endDeco(doc, result, linesPerPage));
    return { result, decos: DecorationSet.create(doc, decos), sigs, options: o, pageCount: result.pages.length, lastUsed: result.pages[result.pages.length - 1].usedRows };
  }

  function update(tr: Transaction, prev: LayoutPluginState): LayoutPluginState {
    const o = prev.options;
    const doc = tr.doc;
    const { result, linesPerPage } = run(doc, o);
    // Ranges touched by this transaction, in new-doc coordinates.
    const dirty: [number, number][] = [];
    tr.mapping.maps.forEach((map, i) => {
      map.forEach((_os, _oe, ns, ne) => {
        const rest = tr.mapping.slice(i + 1);
        dirty.push([rest.map(ns, -1), rest.map(ne, 1)]);
      });
    });
    let decos = prev.decos.map(tr.mapping, doc);
    const sigs = new Map<string, string>();
    const remove: Decoration[] = [];
    const add: Decoration[] = [];
    doc.forEach((node, pos) => {
      const id = node.attrs.id as string;
      const end = pos + node.nodeSize;
      const li = result.info.get(id);
      const sig = signature(li, o.sceneNumbers?.get(id), o.sceneNumberSide, node.attrs.revisionMarked, o.showPageBreaks, unsafeWrap(node, o), node.type.name === 'scene' ? (o.collapsed.has(id) ? 'F' : 'f') : '');
      sigs.set(id, sig);
      let touched = prev.sigs.get(id) !== sig;
      if (!touched) for (const [a, b] of dirty) if (a <= end && b >= pos) { touched = true; break; }
      if (touched) {
        for (const d of decos.find(pos, end, (spec) => spec.id === id)) remove.push(d);
        for (const d of decosFor(pos, node, li, o)) add.push(d);
      }
    });
    // Decorations whose line disappeared (joined or deleted).
    let idsChanged = sigs.size !== prev.sigs.size;
    if (!idsChanged && dirty.length) for (const id of sigs.keys()) if (!prev.sigs.has(id)) { idsChanged = true; break; }
    if (idsChanged) for (const d of decos.find(undefined, undefined, (spec) => spec.id !== '__end' && !sigs.has(spec.id))) remove.push(d);
    // The end filler only changes when the last page's used rows change.
    const lastUsed = result.pages[result.pages.length - 1].usedRows;
    if (lastUsed !== prev.lastUsed || idsChanged || !o.showPageBreaks) {
      for (const d of decos.find(Math.max(0, doc.content.size - 1), doc.content.size, (spec) => spec.id === '__end')) remove.push(d);
      if (o.showPageBreaks) add.push(endDeco(doc, result, linesPerPage));
    }
    if (remove.length) decos = decos.remove(remove);
    if (add.length) decos = decos.add(doc, add);
    return { result, decos, sigs, options: o, pageCount: result.pages.length, lastUsed };
  }

  return new Plugin<LayoutPluginState>({
    key: layoutKey,
    state: {
      init: (_c, state) => build(state.doc, initial),
      apply(tr, prev) {
        const meta = tr.getMeta(layoutKey) as Partial<LayoutPluginOptions> | undefined;
        if (meta) return build(tr.doc, { ...prev.options, ...meta });
        if (!tr.docChanged) return prev;
        if (tr.getMeta('rebuildLayout')) return build(tr.doc, prev.options);
        return update(tr, prev);
      },
    },
    props: {
      decorations: (state) => layoutKey.getState(state)?.decos,
    },
  });
}

export function getLayout(state: EditorState): LayoutPluginState | undefined {
  return layoutKey.getState(state);
}

/** Page (1-based) and total for the line containing the selection head. */
export function pageOfSelection(state: EditorState): { page: number; total: number } {
  const ls = layoutKey.getState(state);
  if (!ls) return { page: 1, total: 1 };
  const node = state.selection.$head.node(1);
  const li = node ? ls.result.info.get(node.attrs.id) : undefined;
  let page = (li?.page ?? 0) + 1;
  if (li && li.splits.length) {
    const off = state.selection.$head.parentOffset;
    for (const s of li.splits) if (off >= s.offset) page = s.page + 1;
  }
  return { page, total: ls.pageCount };
}
