// Single access point to the live editor for menus, panels and dialogs.
import type { Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Line } from '../storage/models';
import { nodeToLine } from './schema';

let view: EditorView | null = null;
let flushFn: (() => Promise<void>) | null = null;

export function setView(v: EditorView | null, flush: (() => Promise<void>) | null = null) {
  view = v;
  flushFn = flush;
  (window as any).__udView = v;
}
export const getView = () => view;

/** Run an editor command and return focus to the page. */
export function exec(cmd: Command, focus = true): boolean {
  if (!view) return false;
  const ok = cmd(view.state, view.dispatch, view);
  if (focus) view.focus();
  return ok;
}

/** Lines of the open document straight from the editor (always current). */
export function currentLines(): Line[] {
  if (!view) return [];
  const out: Line[] = [];
  view.state.doc.forEach((n) => { out.push(nodeToLine(n)); });
  return out;
}

/** Write pending edits to IndexedDB now. */
export async function flushEditor() {
  if (flushFn) await flushFn();
}

export function focusEditor() { view?.focus(); }
