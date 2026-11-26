import { toggleMark } from 'prosemirror-commands';
import type { Node as PMNode } from 'prosemirror-model';
import { type Command, type EditorState, NodeSelection, TextSelection, type Transaction } from 'prosemirror-state';
import { ulid } from 'ulid';
import type { Align, ElementType } from '../layout/geometry';
import type { FlowRow } from '../storage/models';
import { DEFAULT_FLOW } from './flow';
import { schema, nodeType, elType } from './schema';

const SPEECH = new Set(['character', 'dialogue', 'parenthetical', 'lyrics']);

export interface Cur { node: PMNode; pos: number; index: number; type: ElementType }

export function current(state: EditorState): Cur {
  const $h = state.selection.$head;
  const index = $h.index(0);
  const node = state.doc.child(Math.min(index, state.doc.childCount - 1));
  const pos = $h.depth >= 1 ? $h.before(1) : $h.pos;
  return { node, pos, index, type: elType(node) };
}

/** Top-level nodes covered by the selection. */
export function selectedNodes(state: EditorState): { node: PMNode; pos: number; index: number }[] {
  const { from, to } = state.selection;
  const out: { node: PMNode; pos: number; index: number }[] = [];
  state.doc.forEach((node, pos, index) => {
    const end = pos + node.nodeSize;
    if (end > from && pos < to || (from === to && from >= pos && from < end)) out.push({ node, pos, index });
  });
  if (!out.length) { const c = current(state); out.push(c); }
  return out;
}

const freshAttrs = (extra: Record<string, unknown> = {}) => {
  const at = new Date().toISOString();
  return { id: ulid(), createdAt: at, updatedAt: at, ...extra };
};

export function setLineType(type: ElementType): Command {
  return (state, dispatch) => {
    const nt = nodeType(type);
    const tr = state.tr;
    for (const { node, pos } of selectedNodes(state)) {
      if (node.type === nt) continue;
      const attrs = { ...node.attrs, dual: SPEECH.has(type) ? node.attrs.dual : null, align: null };
      tr.setNodeMarkup(pos, nt, attrs);
    }
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Insert a new empty line of `type` after the current line and put the cursor in it. */
export function insertLineAfter(type: ElementType, text = '', attrs: Record<string, unknown> = {}): Command {
  return (state, dispatch) => {
    const cur = current(state);
    const at = cur.pos + cur.node.nodeSize;
    const dual = SPEECH.has(type) ? cur.node.attrs.dual : null;
    const node = nodeType(type).create(freshAttrs({ dual, ...attrs }), text ? schema.text(text) : undefined);
    const tr = state.tr.insert(at, node);
    tr.setSelection(TextSelection.create(tr.doc, at + 1 + text.length));
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Insert an element. If the current line is empty it is converted instead. */
export function insertElement(type: ElementType, text = ''): Command {
  return (state, dispatch, view) => {
    const cur = current(state);
    if (cur.node.content.size === 0) {
      const tr = state.tr.setNodeMarkup(cur.pos, nodeType(type), { ...cur.node.attrs, dual: null });
      if (text) tr.insertText(text, cur.pos + 1);
      if (dispatch) dispatch(tr.scrollIntoView());
      return true;
    }
    return insertLineAfter(type, text)(state, dispatch, view);
  };
}

export function enterCommand(getFlow: () => Record<string, FlowRow>): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    if (sel instanceof NodeSelection) return false;
    const cur = current(state);
    const flow = getFlow()[cur.type] ?? DEFAULT_FLOW[cur.type];
    const empty = cur.node.content.size === 0;
    if (empty && sel.empty) {
      const target = flow.enterEmpty;
      if (target === cur.type) return splitAs(cur.type)(state, dispatch);
      if (dispatch) dispatch(state.tr.setNodeMarkup(cur.pos, nodeType(target), { ...cur.node.attrs, dual: SPEECH.has(target) ? cur.node.attrs.dual : null }).scrollIntoView());
      return true;
    }
    const atEnd = sel.empty && sel.$head.parentOffset === cur.node.content.size;
    return splitAs(atEnd ? flow.enter : cur.type)(state, dispatch);
  };
}

function splitAs(type: ElementType): Command {
  return (state, dispatch) => {
    const tr = state.tr;
    if (!state.selection.empty) tr.deleteSelection();
    const $pos = tr.selection.$from;
    const cur = $pos.node(1);
    if (!cur) return false;
    const dual = SPEECH.has(type) ? cur.attrs.dual : null;
    tr.split($pos.pos, 1, [{ type: nodeType(type), attrs: freshAttrs({ dual }) }]);
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  };
}

export function tabCommand(getFlow: () => Record<string, FlowRow>): Command {
  return (state, dispatch, view) => {
    const cur = current(state);
    const flow = getFlow()[cur.type] ?? DEFAULT_FLOW[cur.type];
    const empty = cur.node.content.size === 0;
    if (!empty) {
      if (cur.type === 'dialogue') return insertLineAfter('parenthetical', '()')(state, (tr) => {
        tr.setSelection(TextSelection.create(tr.doc, tr.selection.from - 1));
        dispatch?.(tr);
      }, view);
      if (cur.type === 'parenthetical') return insertLineAfter('dialogue')(state, dispatch, view);
      if (cur.type === 'character') {
        // Tab after a name starts an extension: NAME (V.O.)
        const text = cur.node.textContent;
        if (!/\($/.test(text)) {
          const end = cur.pos + 1 + cur.node.content.size;
          const tr = state.tr.insertText(/\s$/.test(text) ? '(' : ' (', end);
          tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(end)));
          if (dispatch) dispatch(tr);
        }
        return true;
      }
    }
    return setLineType(flow.tab)(state, dispatch, view);
  };
}

export const shiftTabCommand: Command = (state, dispatch, view) => {
  const cur = current(state);
  const back: Partial<Record<ElementType, ElementType>> = {
    character: 'action', transition: 'character', parenthetical: 'dialogue', dialogue: 'character', scene: 'transition',
  };
  return setLineType(back[cur.type] ?? 'action')(state, dispatch, view);
};

/** Backspace on an empty non-action line turns it into action first (WriterDuet does the same). */
export const backspaceEmpty: Command = (state, dispatch) => {
  const sel = state.selection;
  if (!sel.empty || sel.$head.parentOffset !== 0) return false;
  const cur = current(state);
  if (cur.index === 0 && cur.node.content.size === 0 && state.doc.childCount === 1 && cur.type !== 'action') {
    if (dispatch) dispatch(state.tr.setNodeMarkup(cur.pos, schema.nodes.action, { ...cur.node.attrs, dual: null }));
    return true;
  }
  return false;
};

interface SpeechBlock { from: number; to: number; start: number; end: number }

/** The character block (character + dialogue/parens) around a top-level index. */
function speechBlockAt(doc: PMNode, index: number): SpeechBlock | null {
  let i = index;
  while (i > 0 && doc.child(i).type.name !== 'character' && SPEECH.has(doc.child(i).type.name)) i--;
  if (doc.child(i).type.name !== 'character') return null;
  let j = i + 1;
  while (j < doc.childCount && SPEECH.has(doc.child(j).type.name) && doc.child(j).type.name !== 'character') j++;
  let start = 0;
  for (let k = 0; k < i; k++) start += doc.child(k).nodeSize;
  let end = start;
  for (let k = i; k < j; k++) end += doc.child(k).nodeSize;
  return { from: i, to: j, start, end };
}

function setDual(tr: Transaction, doc: PMNode, b: SpeechBlock, dual: 'left' | 'right' | null) {
  let pos = b.start;
  for (let k = b.from; k < b.to; k++) {
    const n = doc.child(k);
    tr.setNodeMarkup(pos, null, { ...n.attrs, dual });
    pos += n.nodeSize;
  }
}

export const dualDialogue: Command = (state, dispatch) => {
  const cur = current(state);
  const b = speechBlockAt(state.doc, cur.index);
  if (!b) return false;
  const tr = state.tr;
  const prev = b.from > 0 ? speechBlockAt(state.doc, b.from - 1) : null;
  const next = b.to < state.doc.childCount ? speechBlockAt(state.doc, b.to) : null;
  if (prev && prev.to === b.from && !state.doc.child(prev.from).attrs.dual) {
    setDual(tr, state.doc, prev, 'left');
    setDual(tr, state.doc, b, 'right');
  } else if (next && next.from === b.to && !state.doc.child(next.from).attrs.dual) {
    setDual(tr, state.doc, b, 'left');
    setDual(tr, state.doc, next, 'right');
  } else {
    // No neighbour to pair with: this block becomes the left side and a new right character is started.
    setDual(tr, state.doc, b, 'left');
    const node = schema.nodes.character.create(freshAttrs({ dual: 'right' }));
    tr.insert(b.end, node);
    tr.setSelection(TextSelection.create(tr.doc, b.end + 1));
  }
  if (dispatch) dispatch(tr.scrollIntoView());
  return true;
};

export const exitDual: Command = (state, dispatch) => {
  const cur = current(state);
  if (!cur.node.attrs.dual) return false;
  const tr = state.tr;
  // Clear the whole dual group around the cursor.
  let i = cur.index;
  while (i > 0 && state.doc.child(i - 1).attrs.dual) i--;
  let pos = 0;
  for (let k = 0; k < i; k++) pos += state.doc.child(k).nodeSize;
  for (let k = i; k < state.doc.childCount && state.doc.child(k).attrs.dual; k++) {
    const n = state.doc.child(k);
    tr.setNodeMarkup(pos, null, { ...n.attrs, dual: null });
    pos += n.nodeSize;
  }
  if (dispatch) dispatch(tr);
  return true;
};

export function moveSelection(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const nodes = selectedNodes(state);
    const first = nodes[0], last = nodes[nodes.length - 1];
    const doc = state.doc;
    if (dir === -1 && first.index === 0) return false;
    if (dir === 1 && last.index === doc.childCount - 1) return false;
    const from = first.pos, to = last.pos + last.node.nodeSize;
    const tr = state.tr;
    const { anchor, head } = state.selection;
    if (dir === -1) {
      const prev = doc.child(first.index - 1);
      const slice = doc.slice(from, to);
      tr.delete(from, to);
      tr.insert(from - prev.nodeSize, slice.content);
      tr.setSelection(TextSelection.create(tr.doc, anchor - prev.nodeSize, head - prev.nodeSize));
    } else {
      const next = doc.child(last.index + 1);
      const slice = doc.slice(to, to + next.nodeSize);
      tr.delete(to, to + next.nodeSize);
      tr.insert(from, slice.content);
      tr.setSelection(TextSelection.create(tr.doc, anchor + next.nodeSize, head + next.nodeSize));
    }
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  };
}

export function setAttrOnSelection(name: string, value: unknown | ((n: PMNode) => unknown)): Command {
  return (state, dispatch) => {
    const tr = state.tr;
    for (const { node, pos } of selectedNodes(state)) {
      const v = typeof value === 'function' ? (value as (n: PMNode) => unknown)(node) : value;
      tr.setNodeMarkup(pos, null, { ...node.attrs, [name]: v });
    }
    if (dispatch) dispatch(tr);
    return true;
  };
}

export const togglePageBreak: Command = (state, dispatch) => {
  const cur = current(state);
  if (dispatch) dispatch(state.tr.setNodeMarkup(cur.pos, null, { ...cur.node.attrs, pageBreakBefore: !cur.node.attrs.pageBreakBefore }));
  return true;
};

export const setAlign = (align: Align | null) => setAttrOnSelection('align', align === 'left' ? null : align);
export const toggleBullet = setAttrOnSelection('bullet', (n: PMNode) => !n.attrs.bullet);

export const toggleBold = toggleMark(schema.marks.bold);
export const toggleItalic = toggleMark(schema.marks.italic);
export const toggleUnderline = toggleMark(schema.marks.underline);
export const toggleStrike = toggleMark(schema.marks.strike);

export function setValueMark(kind: 'color' | 'highlight', value: string | null): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (empty) return false;
    const tr = state.tr.removeMark(from, to, schema.marks[kind]);
    if (value) tr.addMark(from, to, schema.marks[kind].create({ value }));
    if (dispatch) dispatch(tr);
    return true;
  };
}

/** Scene range (heading through the line before the next heading) around the cursor. */
export function sceneRange(state: EditorState, index = current(state).index): { from: number; to: number; first: number; last: number } | null {
  const doc = state.doc;
  let i = index;
  while (i >= 0 && doc.child(i).type.name !== 'scene') i--;
  if (i < 0) return null;
  let j = i + 1;
  while (j < doc.childCount && doc.child(j).type.name !== 'scene') j++;
  let from = 0;
  for (let k = 0; k < i; k++) from += doc.child(k).nodeSize;
  let to = from;
  for (let k = i; k < j; k++) to += doc.child(k).nodeSize;
  return { from, to, first: i, last: j - 1 };
}

export const omitScene: Command = (state, dispatch) => {
  const r = sceneRange(state);
  if (!r) return false;
  const omitted = !state.doc.child(r.first).attrs.omitted;
  const tr = state.tr;
  let pos = r.from;
  for (let k = r.first; k <= r.last; k++) {
    const n = state.doc.child(k);
    tr.setNodeMarkup(pos, null, { ...n.attrs, omitted });
    pos += n.nodeSize;
  }
  if (dispatch) dispatch(tr);
  return true;
};

/** Separate Scene: start a new scene heading at the cursor line, copying the current heading. */
export const separateScene: Command = (state, dispatch) => {
  const cur = current(state);
  const r = sceneRange(state);
  const heading = r ? state.doc.child(r.first).textContent : 'INT. ';
  if (cur.type === 'scene') return false;
  const node = schema.nodes.scene.create(freshAttrs(), heading ? schema.text(heading) : undefined);
  const tr = state.tr.insert(cur.pos, node);
  tr.setSelection(TextSelection.create(tr.doc, cur.pos + 1 + heading.length));
  if (dispatch) dispatch(tr.scrollIntoView());
  return true;
};

export function jumpToLine(id: string, offset = 0): Command {
  return (state, dispatch) => {
    let found = -1;
    let size = 0;
    state.doc.forEach((node, pos) => { if (found < 0 && node.attrs.id === id) { found = pos; size = node.content.size; } });
    if (found < 0) return false;
    if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, found + 1 + Math.min(offset, size))).scrollIntoView());
    return true;
  };
}

export { freshAttrs };
