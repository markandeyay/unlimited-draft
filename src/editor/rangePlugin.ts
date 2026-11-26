// Generic inline highlight plugins (find matches, comments, spelling).
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export interface Range { from: number; to: number; cls: string; attrs?: Record<string, string> }

export function createRangePlugin(name: string) {
  const key = new PluginKey<DecorationSet>(name);
  const plugin = new Plugin<DecorationSet>({
    key,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const ranges = tr.getMeta(key) as Range[] | undefined;
        if (ranges) {
          const max = tr.doc.content.size;
          return DecorationSet.create(tr.doc, ranges.filter((r) => r.from < r.to && r.to <= max)
            .map((r) => Decoration.inline(r.from, r.to, { class: r.cls, ...(r.attrs ?? {}) })));
        }
        return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
      },
    },
    props: { decorations: (state) => key.getState(state) },
  });
  return { key, plugin };
}

export const findRanges = createRangePlugin('find');
export const commentRanges = createRangePlugin('comments');
export const spellRanges = createRangePlugin('spell');
