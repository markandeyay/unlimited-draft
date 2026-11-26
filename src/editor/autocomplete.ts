import { elType } from './schema';
// Autocomplete dropdown for Character, Scene and Transition lines.
import type { EditorState } from 'prosemirror-state';
import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { speakerName } from '../layout/paginate';
import { CHARACTER_EXTENSIONS, SCENE_INTROS, SCENE_TIMES, TRANSITIONS } from './flow';

export interface Suggestion {
  label: string;
  from: number;
  to: number;
  text: string;
  /** After accepting with Enter, continue with the normal Enter behavior. */
  thenEnter: boolean;
}

const INTRO_RE = /^(INT\.\/EXT\.|INT\.|EXT\.|I\/E)\s+/i;

export function computeSuggestions(state: EditorState): Suggestion[] {
  const sel = state.selection;
  if (!sel.empty) return [];
  const $h = sel.$head;
  const node = $h.parent;
  if ($h.depth < 1 || $h.parentOffset !== node.content.size) return [];
  const type = elType(node);
  if (type !== 'character' && type !== 'scene' && type !== 'transition') return [];
  const text = node.textContent;
  const upper = text.toUpperCase();
  const start = $h.start();
  const end = start + node.content.size;
  const mk = (label: string, fromOff: number, insert: string, thenEnter: boolean): Suggestion => ({ label, from: start + fromOff, to: end, text: insert, thenEnter });

  if (type === 'character') {
    const paren = upper.indexOf('(');
    if (paren >= 0) {
      const partial = upper.slice(paren);
      return CHARACTER_EXTENSIONS.filter((e) => e.startsWith(partial) && e !== partial).map((e) => mk(e, paren, e, true));
    }
    const count = new Map<string, number>();
    const order: string[] = [];
    state.doc.forEach((n) => {
      if (n.type.name !== 'character' || n === node) return;
      const name = speakerName(n.textContent);
      if (!name) return;
      count.set(name, (count.get(name) ?? 0) + 1);
      order.push(name);
    });
    const q = upper.trim();
    let names = [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)! || a.localeCompare(b));
    if (!q) {
      // On an empty line, offer the other speaker of the conversation first.
      const idx = $h.index(0);
      const before: string[] = [];
      for (let i = idx - 1; i >= 0 && before.length < 2; i--) {
        const n = state.doc.child(i);
        if (n.type.name === 'scene') break;
        if (n.type.name === 'character') {
          const nm = speakerName(n.textContent);
          if (nm && !before.includes(nm)) before.push(nm);
        }
      }
      const pref = before.length === 2 ? [before[1], before[0]] : before;
      names = [...pref, ...names.filter((n) => !pref.includes(n))];
    } else {
      names = names.filter((n) => n.startsWith(q) && n !== q);
    }
    return names.slice(0, 8).map((n) => mk(n, 0, n, true));
  }

  if (type === 'transition') {
    const used: string[] = [];
    state.doc.forEach((n) => { if (n.type.name === 'transition' && n !== node) { const t = n.textContent.toUpperCase().trim(); if (t && !used.includes(t)) used.push(t); } });
    const all = [...TRANSITIONS, ...used.filter((u) => !TRANSITIONS.includes(u))];
    return all.filter((t) => t.startsWith(upper) && t !== upper).slice(0, 8).map((t) => mk(t, 0, t, true));
  }

  // Scene heading: intro, then location, then time of day.
  const intro = upper.match(INTRO_RE);
  if (!intro) {
    return SCENE_INTROS.filter((i) => i.startsWith(upper) && !(upper.length > i.length)).map((i) => mk(i, 0, `${i} `, false));
  }
  const rest = upper.slice(intro[0].length);
  const dash = rest.lastIndexOf(' - ');
  const locations: string[] = [];
  const times: string[] = [];
  state.doc.forEach((n) => {
    if (n.type.name !== 'scene' || n === node) return;
    const t = n.textContent.toUpperCase();
    const m = t.match(INTRO_RE);
    if (!m) return;
    const r = t.slice(m[0].length);
    const d = r.lastIndexOf(' - ');
    const loc = (d >= 0 ? r.slice(0, d) : r).trim();
    if (loc && !locations.includes(loc)) locations.push(loc);
    if (d >= 0) { const tm = r.slice(d + 3).trim(); if (tm && !times.includes(tm)) times.push(tm); }
  });
  if (dash >= 0) {
    const partial = rest.slice(dash + 3);
    const all = [...SCENE_TIMES, ...times.filter((t) => !SCENE_TIMES.includes(t))];
    return all.filter((t) => t.startsWith(partial) && t !== partial).slice(0, 9).map((t) => mk(t, intro[0].length + dash + 3, t, true));
  }
  return locations.filter((l) => l.startsWith(rest) && l !== rest).slice(0, 8).map((l) => mk(l, intro[0].length, `${l} - `, false));
}

export function autocompletePlugin(isEnabled: () => boolean, onEnter: (view: EditorView) => void) {
  let items: Suggestion[] = [];
  let index = 0;
  let dismissed = '';
  let el: HTMLDivElement | null = null;

  const keyOf = (state: EditorState) => `${state.selection.$head.parent.attrs.id}|${state.selection.$head.parent.textContent}`;

  const accept = (view: EditorView, i: number, viaEnter: boolean) => {
    const s = items[i];
    if (!s) return false;
    const tr = view.state.tr.insertText(s.text, s.from, s.to).setMeta('noAuto', true);
    view.dispatch(tr);
    if (viaEnter && s.thenEnter) onEnter(view);
    return true;
  };

  const render = (view: EditorView) => {
    if (!el) return;
    if (!items.length || !view.hasFocus()) { el.style.display = 'none'; return; }
    el.innerHTML = '';
    items.forEach((s, i) => {
      const d = document.createElement('div');
      d.className = `ac-item${i === index ? ' ac-active' : ''}`;
      d.textContent = s.label;
      d.addEventListener('mousedown', (e) => { e.preventDefault(); accept(view, i, false); view.focus(); });
      el!.appendChild(d);
    });
    const c = view.coordsAtPos(view.state.selection.head);
    const anchor = view.coordsAtPos(items[0].from);
    el.style.display = 'block';
    el.style.left = `${Math.min(anchor.left, window.innerWidth - 240)}px`;
    el.style.top = `${c.bottom + 2}px`;
  };

  return new Plugin({
    view(view) {
      el = document.createElement('div');
      el.className = 'ac-menu';
      el.setAttribute('data-testid', 'autocomplete');
      el.style.display = 'none';
      document.body.appendChild(el);
      const onBlur = () => setTimeout(() => { if (el && !view.hasFocus()) el.style.display = 'none'; }, 100);
      view.dom.addEventListener('blur', onBlur);
      return {
        update(v) {
          const next = isEnabled() ? computeSuggestions(v.state) : [];
          const k = keyOf(v.state);
          if (dismissed && dismissed !== k) dismissed = '';
          items = dismissed ? [] : next;
          if (index >= items.length) index = 0;
          render(v);
        },
        destroy() {
          view.dom.removeEventListener('blur', onBlur);
          el?.remove();
          el = null;
        },
      };
    },
    props: {
      handleKeyDown(view, e) {
        if (!items.length) return false;
        if (e.key === 'ArrowDown') { index = (index + 1) % items.length; render(view); return true; }
        if (e.key === 'ArrowUp') { index = (index - 1 + items.length) % items.length; render(view); return true; }
        if (e.key === 'Escape') { dismissed = keyOf(view.state); items = []; render(view); return true; }
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
          // An empty line keeps the normal Enter behavior unless the user moved through the list.
          if (view.state.selection.$head.parent.content.size === 0 && index === 0) return false;
          return accept(view, index, true);
        }
        if (e.key === 'Tab' && !e.shiftKey) {
          if (view.state.selection.$head.parent.content.size === 0 && index === 0) return false;
          return accept(view, index, false);
        }
        return false;
      },
    },
  });
}
