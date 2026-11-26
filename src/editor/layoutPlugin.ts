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
}

export interface LayoutPluginState {
  result: LayoutResult;
  decos: DecorationSet;
  sigs: Map<string, string>;
  options: LayoutPluginOptions;
  pageCount: number;
}

export const layoutKey = new PluginKey<LayoutPluginState>('layout');

export const defaultLayoutPluginOptions = (): LayoutPluginOptions => ({
  layout: {}, showPageBreaks: true, sceneNumbers: null, sceneNumberSide: 'both', hide: new Set(), onlyIds: null, numberFirstPage: false,
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

function signature(li: LineInfo | undefined, sn: string | undefined, side: string, rev: boolean, pb: boolean): string {
  if (!li) return 'hidden';
  let s = `${li.spaceBefore}|${li.contd ? 1 : 0}|${li.wraps.join(',')}|${sn ?? ''}${sn ? side : ''}|${rev ? 1 : 0}`;
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
  const attrs: Record<string, string> = { class: `sb${li.spaceBefore}${li.contd ? ' contd' : ''}` };
  const sn = o.sceneNumbers?.get(id);
  if (sn && node.type.name === 'scene') {
    if (o.sceneNumberSide !== 'right') attrs['data-snl'] = sn;
    if (o.sceneNumberSide !== 'left') attrs['data-snr'] = sn;
  }
  out.push(Decoration.node(pos, end, attrs, { id }));
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
    } else {
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
    doc.forEach((node) => {
      const l = toLayoutLine(node);
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
      sigs.set(id, signature(li, o.sceneNumbers?.get(id), o.sceneNumberSide, node.attrs.revisionMarked, o.showPageBreaks));
      for (const d of decosFor(pos, node, li, o)) decos.push(d);
    });
    if (o.showPageBreaks) decos.push(endDeco(doc, result, linesPerPage));
    return { result, decos: DecorationSet.create(doc, decos), sigs, options: o, pageCount: result.pages.length };
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
      const sig = signature(li, o.sceneNumbers?.get(id), o.sceneNumberSide, node.attrs.revisionMarked, o.showPageBreaks);
      sigs.set(id, sig);
      let touched = prev.sigs.get(id) !== sig;
      if (!touched) for (const [a, b] of dirty) if (a <= end && b >= pos) { touched = true; break; }
      if (touched) {
        for (const d of decos.find(pos, end, (spec) => spec.id === id)) remove.push(d);
        for (const d of decosFor(pos, node, li, o)) add.push(d);
      }
    });
    // Decorations whose line disappeared (joined or deleted), and the end filler.
    for (const d of decos.find(undefined, undefined, (spec) => spec.id === '__end' || !sigs.has(spec.id))) remove.push(d);
    if (o.showPageBreaks) add.push(endDeco(doc, result, linesPerPage));
    if (remove.length) decos = decos.remove(remove);
    if (add.length) decos = decos.add(doc, add);
    return { result, decos, sigs, options: o, pageCount: result.pages.length };
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
