import { useEffect, useState } from 'react';
import { useApp } from '../app/store';
import { getView } from '../editor/controller';
import { spellRanges } from '../editor/rangePlugin';
import { useSettings } from '../settings/settings';
import { MenuList, type MenuItem } from '../ui/MenuBar';
import { addToDictionary, checkDocument, ignoreWord, suggest, toRanges } from './spell';

/** Underlines misspellings after each save and offers suggestions on right click. */
export function SpellLayer() {
  const on = useSettings((s) => s.settings.editing.spellCheck);
  // The title page is mostly names, so it is not spell checked.
  const isTitle = useApp((s) => s.docs.find((d) => d.id === s.activeDocId)?.kind === 'titlePage');
  const enabled = on && !isTitle;
  const docVersion = useApp((s) => s.docVersion);
  const docId = useApp((s) => s.activeDocId);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const clear = () => {
      const v = getView();
      if (v) v.dispatch(v.state.tr.setMeta(spellRanges.key, []).setMeta('addToHistory', false));
    };
    if (!enabled) { clear(); return; }
    let live = true;
    const t = setTimeout(() => {
      const view = getView();
      if (!view) return;
      const doc = view.state.doc;
      void checkDocument(doc).then((ms) => {
        const v = getView();
        // Positions are only valid if the document has not changed since the check started.
        if (!live || !v || v.state.doc !== doc) return;
        v.dispatch(v.state.tr.setMeta(spellRanges.key, toRanges(ms)).setMeta('addToHistory', false));
      }).catch(() => undefined);
    }, 900);
    return () => { live = false; clearTimeout(t); };
  }, [enabled, docVersion, docId, tick]);

  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('.spell') as HTMLElement | null;
      const view = getView();
      if (!el || !view || !view.dom.contains(el)) return;
      e.preventDefault();
      const word = el.getAttribute('data-word') ?? el.textContent ?? '';
      const from = view.posAtDOM(el, 0);
      const to = from + (el.textContent?.length ?? word.length);
      const open = (sugg: string[]) => setMenu({
        x: e.clientX, y: e.clientY,
        items: [
          ...(sugg.length ? sugg.map((s): MenuItem => ({ label: s, action: () => { const v = getView(); if (v) { v.dispatch(v.state.tr.insertText(s, from, to)); v.focus(); } } })) : [{ label: 'No suggestions', disabled: true } as MenuItem]),
          'sep',
          { label: 'Add to dictionary', action: () => { void addToDictionary(word).then(() => setTick((t) => t + 1)); } },
          { label: 'Ignore', action: () => { ignoreWord(word); setTick((t) => t + 1); } },
        ],
      });
      open([]);
      void suggest(word).then(open).catch(() => undefined);
    };
    const close = () => setMenu(null);
    document.addEventListener('contextmenu', onCtx);
    document.addEventListener('click', close);
    return () => { document.removeEventListener('contextmenu', onCtx); document.removeEventListener('click', close); };
  }, []);

  if (!menu) return null;
  return (
    <div style={{ position: 'fixed', left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y, window.innerHeight - 260), zIndex: 120 }} data-testid="spell-menu">
      <MenuList items={menu.items} onClose={() => setMenu(null)} />
    </div>
  );
}
