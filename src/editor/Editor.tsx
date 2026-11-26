import { history } from 'prosemirror-history';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { useEffect, useMemo, useRef } from 'react';
import { useApp } from '../app/store';
import { CHAR_PX, ELEMENT_TYPES, type ElementType, type PageGeometry } from '../layout/geometry';
import { computeSceneNumbers } from '../layout/sceneNumbers';
import { geometryFromSettings, layoutOptionsFor, useSettings } from '../settings/settings';
import { recordLocalVersion } from '../history/history';
import { deviceName, saveDocument } from '../storage/db';
import type { DocumentFile, Line } from '../storage/models';
import { autocompletePlugin } from './autocomplete';
import { jumpToLine } from './commands';
import { setView } from './controller';
import { buildKeymaps } from './keymap';
import { type LayoutPluginOptions, createLayoutPlugin, layoutKey, pageOfSelection } from './layoutPlugin';
import { behaviorKey, behaviorPlugin, currentLinePlugin, idPlugin, trackingPlugin, typingPlugin } from './plugins';
import { commentRanges, findRanges, spellRanges } from './rangePlugin';
import { docToLines, linesToDoc, elType } from './schema';
import './editor.css';

/** CSS for element indents and widths, generated from the same geometry the PDF uses. */
export function geometryCss(g: PageGeometry): string {
  const base = g.elements.action.left;
  const pagePad = base * CHAR_PX;
  let css = `.pm-page .ProseMirror{padding-left:${pagePad}px;--page-left:${pagePad}px;padding-top:${(g.topPt * 96) / 72}px;width:${(g.widthPt * 96) / 72}px}`;
  css += `.pm-page{width:${(g.widthPt * 96) / 72}px}`;
  for (const t of ELEMENT_TYPES) {
    const s = g.elements[t];
    const x = (s.left - base) * CHAR_PX;
    css += `.pm-page .el-${t}{margin-left:${x}px;--ex:${x}px;width:${s.width * CHAR_PX}px;`;
    css += `text-align:${s.align};text-transform:${s.uppercase ? 'uppercase' : 'none'};font-weight:${s.bold ? 700 : 400};`;
    css += `font-style:${s.italic ? 'italic' : 'normal'};text-decoration:${s.underline ? 'underline' : 'none'};`;
    css += `text-indent:${s.hang ? -s.hang * CHAR_PX : 0}px}`;
  }
  const d = g.dual;
  const lx = (d.leftCol - base) * CHAR_PX, rx = (d.rightCol - base) * CHAR_PX, w = d.width * CHAR_PX, pi = d.parenIndent * CHAR_PX;
  css += `.pm-page .el[data-dual=left]{float:left;clear:left;margin-left:${lx}px;--ex:${lx}px;width:${w}px}`;
  css += `.pm-page .el[data-dual=right]{clear:none;margin-left:${rx}px;--ex:${rx}px;width:${w}px}`;
  css += `.pm-page .el-character[data-dual]{text-align:center}`;
  css += `.pm-page .el-parenthetical[data-dual=left]{margin-left:${lx + pi}px;--ex:${lx + pi}px;width:${w - pi * 2}px}`;
  css += `.pm-page .el-parenthetical[data-dual=right]{margin-left:${rx + pi}px;--ex:${rx + pi}px;width:${w - pi * 2}px}`;
  css += `.pm-page .pb-contd,.pm-page .pb-more{left:${g.elements.character.left * CHAR_PX}px}`;
  css += `.pm-page .pb-num{left:${g.pageNumberCol * CHAR_PX}px}`;
  css += `.pm-page .pb,.pm-page .pb-end{width:${(g.widthPt * 96) / 72}px}`;
  return css;
}

export function Editor({ document: docFile, readOnly = false }: { document: DocumentFile; readOnly?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const docRef = useRef(docFile);
  const settings = useSettings((s) => s.settings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // Dialogs replace the document object when metadata changes; keep saving into the newest one.
  if (docRef.current.id === docFile.id && docRef.current !== docFile) { docFile.lines = docRef.current.lines; docRef.current = docFile; }
  const hideShots = useApp((s) => s.hideShots);
  const hideNotes = useApp((s) => s.hideNotes);
  const filter = useApp((s) => s.filter);

  const geometry = useMemo(() => geometryFromSettings(settings), [settings]);
  const css = useMemo(() => geometryCss(geometry), [geometry]);

  const pluginOptions = (doc: DocumentFile, lines?: Line[]): LayoutPluginOptions => {
    const s = settingsRef.current;
    const st = useApp.getState();
    const hide = new Set<ElementType>(st.filter?.hide ?? []);
    if (st.hideShots) hide.add('shot');
    if (st.hideNotes) hide.add('note');
    const sn = doc.sceneNumbers.enabled
      ? computeSceneNumbers(lines ?? doc.lines, { locked: doc.sceneNumbers.locked, start: doc.settings.sceneNumberStart })
      : null;
    return {
      layout: layoutOptionsFor(s, doc),
      showPageBreaks: s.display.showPageBreaks && doc.kind !== 'pad',
      sceneNumbers: sn,
      sceneNumberSide: doc.settings.sceneNumberSide,
      hide,
      onlyIds: st.filter?.onlyIds ? new Set(st.filter.onlyIds) : null,
      numberFirstPage: s.page.firstPageNumbered,
    };
  };

  // Create the editor once per document.
  useEffect(() => {
    docRef.current = docFile;
    const s = settingsRef.current;
    const { enter, plugins: keymaps } = buildKeymaps(() => settingsRef.current.editing.flow);
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let dirty = false;
    let prev = new Map(docFile.lines.map((l) => [l.id, l]));
    const device = deviceName();

    const save = async () => {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      const view = viewRef.current;
      if (!dirty || !view) return;
      dirty = false;
      const lines = docToLines(view.state.doc, prev, device);
      prev = new Map(lines.map((l) => [l.id, l]));
      const doc = docRef.current;
      doc.lines = lines;
      const pages = layoutKey.getState(view.state)?.pageCount;
      await saveDocument(doc, pages);
      void recordLocalVersion(doc);
      useApp.setState((st) => ({ docVersion: st.docVersion + 1, sync: { ...st.sync, lastOffline: new Date().toISOString() } }));
    };

    const state = EditorState.create({
      doc: linesToDoc(docFile.lines),
      plugins: [
        behaviorPlugin({
          autoCapitalize: s.editing.autoCapitalize, smartQuotes: s.editing.smartQuotes,
          highlightCurrentLine: s.display.highlightCurrentLine,
          trackingColor: docFile.revision.tracking ? docFile.revision.color : null,
        }),
        autocompletePlugin(() => settingsRef.current.editing.autocomplete && docRef.current.kind !== 'titlePage', (v) => { enter(v.state, v.dispatch, v); }),
        ...keymaps,
        history(),
        typingPlugin(),
        idPlugin(),
        trackingPlugin(),
        createLayoutPlugin(pluginOptions(docFile)),
        currentLinePlugin(),
        findRanges.plugin,
        commentRanges.plugin,
        spellRanges.plugin,
      ],
    });

    const pushCursor = (st: EditorState) => {
      const $h = st.selection.$head;
      const node = $h.node(1) ?? st.doc.firstChild!;
      const marks = st.storedMarks ?? $h.marks();
      const has = (n: string) => marks.some((m) => m.type.name === n);
      const { page, total } = pageOfSelection(st);
      const next = {
        type: elType(node), dual: !!node.attrs.dual, page, total,
        bold: has('bold'), italic: has('italic'), underline: has('underline'), strike: has('strike'), lineId: node.attrs.id as string,
      };
      const cur = useApp.getState().cursor;
      if ((Object.keys(next) as (keyof typeof next)[]).some((k) => cur[k] !== next[k])) useApp.setState({ cursor: next });
    };

    const view = new EditorView(host.current!, {
      state,
      editable: () => !readOnly,
      attributes: { spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off', 'data-testid': 'editor' },
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        if (tr.docChanged) {
          dirty = true;
          if (saveTimer) clearTimeout(saveTimer);
          saveTimer = setTimeout(save, 700);
          if (docRef.current.sceneNumbers.enabled && tr.getMeta('addToHistory') !== false && !tr.getMeta(layoutKey)) {
            // Scene count may have changed: refresh numbers lazily.
            queueMicrotask(() => {
              const v = viewRef.current;
              if (!v) return;
              const doc = docRef.current;
              const lines: { id: string; type: string; sceneNumber?: string }[] = [];
              v.state.doc.forEach((n) => { if (n.type.name === 'scene') lines.push({ id: n.attrs.id, type: 'scene', sceneNumber: n.attrs.sceneNumber ?? undefined }); });
              const sn = computeSceneNumbers(lines, { locked: doc.sceneNumbers.locked, start: doc.settings.sceneNumberStart });
              const cur = layoutKey.getState(v.state)?.options.sceneNumbers;
              let same = !!cur && cur.size === sn.size;
              if (same) for (const [k, val] of sn) if (cur!.get(k) !== val) { same = false; break; }
              if (!same) v.dispatch(v.state.tr.setMeta(layoutKey, { sceneNumbers: sn }));
            });
          }
        }
        pushCursor(next);
      },
    });
    viewRef.current = view;
    setView(view, save);
    pushCursor(view.state);

    const lineId = (useApp.getState().route as any).lineId as string | undefined;
    if (lineId) setTimeout(() => { jumpToLine(lineId)(view.state, view.dispatch, view); view.focus(); }, 50);
    else if (!readOnly && window.innerWidth >= 768) view.focus();

    const onHide = () => { void save(); };
    window.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      void save();
      setView(null);
      view.destroy();
      viewRef.current = null;
    };
  }, [docFile.id, readOnly]);

  // Push option changes into the live editor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const doc = docRef.current;
    const lines: Line[] = [];
    view.state.doc.forEach((n) => { lines.push({ id: n.attrs.id, type: elType(n), text: '', sceneNumber: n.attrs.sceneNumber ?? undefined, createdAt: '', updatedAt: '' }); });
    const tr = view.state.tr
      .setMeta(layoutKey, pluginOptions(doc, lines))
      .setMeta(behaviorKey, {
        autoCapitalize: settings.editing.autoCapitalize, smartQuotes: settings.editing.smartQuotes,
        highlightCurrentLine: settings.display.highlightCurrentLine,
        trackingColor: doc.revision.tracking ? doc.revision.color : null,
      });
    view.dispatch(tr);
  }, [settings, hideShots, hideNotes, filter, docFile.sceneNumbers.enabled, docFile.sceneNumbers.locked, docFile.settings.sceneNumberSide, docFile.settings.sceneNumberStart, docFile.settings.sceneContinueds, docFile.revision.tracking, docFile.revision.color]);

  return (
    <div className={`pm-page${docFile.kind === 'pad' ? ' pm-pad' : ''}${docFile.kind === 'titlePage' ? ' pm-title' : ''}`}>
      <style>{css}</style>
      <div ref={host} />
    </div>
  );
}
