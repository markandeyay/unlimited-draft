import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { ulid } from 'ulid';
import { SCENE_START, TRANSITION_END } from './flow';
import { schema, elType } from './schema';

export interface EditorBehavior {
  autoCapitalize: boolean;
  smartQuotes: boolean;
  highlightCurrentLine: boolean;
  /** Revision color while tracking, else null. */
  trackingColor: string | null;
}

export const behaviorKey = new PluginKey<EditorBehavior>('behavior');

/** Holds live behavior flags so settings can change without rebuilding the editor. */
export function behaviorPlugin(initial: EditorBehavior) {
  return new Plugin<EditorBehavior>({
    key: behaviorKey,
    state: {
      init: () => initial,
      apply: (tr, prev) => {
        const meta = tr.getMeta(behaviorKey) as Partial<EditorBehavior> | undefined;
        return meta ? { ...prev, ...meta } : prev;
      },
    },
  });
}

/** Every line gets a unique stable id. On a split the left half keeps the id, the right half gets a new one. */
export function idPlugin() {
  return new Plugin({
    appendTransaction(trs, _old, state) {
      if (!trs.some((t) => t.docChanged)) return null;
      const seen = new Set<string>();
      let tr = null as ReturnType<typeof state.tr.setNodeMarkup> | null;
      const at = new Date().toISOString();
      state.doc.forEach((node, pos) => {
        const id = node.attrs.id as string;
        if (!id || seen.has(id)) {
          const nid = ulid();
          tr = (tr ?? state.tr).setNodeMarkup(pos, null, { ...node.attrs, id: nid, createdAt: at, updatedAt: at, sceneNumber: id ? null : node.attrs.sceneNumber, history: null });
          seen.add(nid);
        } else {
          seen.add(id);
        }
      });
      if (tr) (tr as any).setMeta('addToHistory', false);
      return tr;
    },
  });
}

/** Marks changed lines with the revision color and an asterisk while tracking is on. */
export function trackingPlugin() {
  return new Plugin({
    appendTransaction(trs, _old, state) {
      const color = behaviorKey.getState(state)?.trackingColor;
      if (!color) return null;
      const changed = trs.filter((t) => t.docChanged && !t.getMeta('noTrack') && t.getMeta('addToHistory') !== false);
      if (!changed.length) return null;
      const ranges: [number, number][] = [];
      for (const t of changed) {
        t.mapping.maps.forEach((map, i) => {
          map.forEach((_a, _b, ns, ne) => {
            let s = ns, e = ne;
            for (let k = i + 1; k < t.mapping.maps.length; k++) { s = t.mapping.maps[k].map(s, -1); e = t.mapping.maps[k].map(e, 1); }
            ranges.push([s, e]);
          });
        });
      }
      if (!ranges.length) return null;
      let tr = null as ReturnType<typeof state.tr.setNodeMarkup> | null;
      state.doc.forEach((node, pos) => {
        const end = pos + node.nodeSize;
        if (node.attrs.revisionColor === color && node.attrs.revisionMarked) return;
        if (ranges.some(([a, b]) => a <= end - 1 && b >= pos + 1)) {
          tr = (tr ?? state.tr).setNodeMarkup(pos, null, { ...node.attrs, revisionColor: color, revisionMarked: true });
        }
      });
      if (tr) (tr as any).setMeta('addToHistory', false).setMeta('noTrack', true);
      return tr;
    },
  });
}

/** Automatic element changes while typing, plus auto-capitalization. */
export function typingPlugin() {
  return new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        const state = view.state;
        const b = behaviorKey.getState(state);
        const $from = state.doc.resolve(from);
        const node = $from.parent;
        const type = elType(node);
        const before = node.textBetween(0, $from.parentOffset);
        // Typing ")" over an auto-inserted closing paren.
        if (text === ')' && from === to && node.textBetween($from.parentOffset, Math.min(node.content.size, $from.parentOffset + 1)) === ')' && type === 'parenthetical') {
          view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from + 1)));
          return true;
        }
        if (text === '(' && from === to && type === 'dialogue' && node.content.size === 0) {
          const tr = state.tr.setNodeMarkup($from.before(1), schema.nodes.parenthetical, node.attrs).insertText('()', from);
          tr.setSelection(TextSelection.create(tr.doc, from + 1));
          view.dispatch(tr);
          return true;
        }
        if (b?.smartQuotes && (text === '"' || text === "'")) {
          const open = before.length === 0 || /[\s([]$/.test(before);
          const ch = text === '"' ? (open ? '“' : '”') : (open ? '‘' : '’');
          view.dispatch(state.tr.insertText(ch, from, to));
          return true;
        }
        if (b?.autoCapitalize && text.length === 1 && text >= 'a' && text <= 'z'
          && (type === 'action' || type === 'dialogue' || type === 'text' || type === 'lyrics')
          && (before.length === 0 || /[.?!]["')]?\s+$/.test(before))) {
          const marks = state.storedMarks ?? $from.marks();
          view.dispatch(state.tr.replaceWith(from, to, schema.text(text.toUpperCase(), marks)));
          return true;
        }
        return false;
      },
    },
    appendTransaction(trs, _old, state) {
      const typed = trs.find((t) => t.docChanged && t.getMeta('addToHistory') !== false && !t.getMeta('paste') && !t.getMeta('noAuto'));
      if (!typed || !state.selection.empty) return null;
      const $h = state.selection.$head;
      const node = $h.parent;
      if (node.type.name !== 'action' || $h.parentOffset !== node.content.size) return null;
      const text = node.textContent;
      if (SCENE_START.test(text) && text.length <= 10 && /[.\s/E]$/i.test(text)) {
        return state.tr.setNodeMarkup($h.before(1), schema.nodes.scene, node.attrs);
      }
      if (TRANSITION_END.test(text) && text === text.toUpperCase() && text.length >= 4) {
        return state.tr.setNodeMarkup($h.before(1), schema.nodes.transition, node.attrs);
      }
      return null;
    },
  });
}

/** Pale yellow band on the line that holds the cursor. */
export function currentLinePlugin() {
  return new Plugin({
    props: {
      decorations(state) {
        if (!behaviorKey.getState(state)?.highlightCurrentLine) return null;
        const $h = state.selection.$head;
        if ($h.depth < 1) return null;
        const pos = $h.before(1);
        return DecorationSet.create(state.doc, [Decoration.node(pos, pos + $h.node(1).nodeSize, { class: 'cur' })]);
      },
    },
  });
}
