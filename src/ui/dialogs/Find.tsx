import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { TextSelection } from 'prosemirror-state';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/store';
import * as cmd from '../../editor/commands';
import { currentLines, exec, getView } from '../../editor/controller';
import { ELEMENT_LABELS, TOOLBAR_ORDER } from '../../editor/flow';
import { findRanges, spellRanges } from '../../editor/rangePlugin';
import { schema, elType } from '../../editor/schema';
import type { ElementType } from '../../layout/geometry';
import { speakerName } from '../../layout/paginate';
import { characterStats } from '../../reports/analyze';
import { type Misspelling, addToDictionary, checkDocument, ignoreWord, suggest, toRanges } from '../../spell/spell';
import { Check, Dialog, Field } from '../Dialogs';
import css from '../dialogs.module.css';

type Scope = 'all' | 'dialogue' | 'action';
interface Match { from: number; to: number }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function findMatches(query: string, opts: { matchCase: boolean; wholeWord: boolean; scope: Scope }): Match[] {
  const view = getView();
  if (!view || !query) return [];
  const re = new RegExp(opts.wholeWord ? `\\b${escapeRe(query)}\\b` : escapeRe(query), opts.matchCase ? 'g' : 'gi');
  const out: Match[] = [];
  view.state.doc.forEach((node, pos) => {
    const t = elType(node);
    if (opts.scope === 'dialogue' && t !== 'dialogue' && t !== 'parenthetical' && t !== 'lyrics') return;
    if (opts.scope === 'action' && t !== 'action' && t !== 'text' && t !== 'shot') return;
    const text = node.textContent;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      out.push({ from: pos + 1 + m.index, to: pos + 1 + m.index + m[0].length });
    }
  });
  return out;
}

export function FindPanel() {
  const close = useApp((s) => s.closeDialog);
  const [query, setQuery] = useState(() => {
    const v = getView();
    if (v && !v.state.selection.empty) { const t = v.state.doc.textBetween(v.state.selection.from, v.state.selection.to, ' '); if (t.length < 60 && !t.includes('\n')) return t; }
    return '';
  });
  const [replace, setReplace] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [scope, setScope] = useState<Scope>('all');
  const [index, setIndex] = useState(0);
  const [version, setVersion] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const docVersion = useApp((s) => s.docVersion);

  const matches = useMemo(() => findMatches(query, { matchCase, wholeWord, scope }), [query, matchCase, wholeWord, scope, version, docVersion]);
  const cur = matches.length ? Math.min(index, matches.length - 1) : -1;

  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  useEffect(() => {
    const view = getView();
    if (!view) return;
    view.dispatch(view.state.tr.setMeta(findRanges.key, matches.map((m, i) => ({ ...m, cls: i === cur ? 'find-hit find-cur' : 'find-hit' }))).setMeta('addToHistory', false));
  }, [matches, cur]);
  useEffect(() => () => {
    const view = getView();
    if (view) view.dispatch(view.state.tr.setMeta(findRanges.key, []).setMeta('addToHistory', false));
  }, []);

  const show = (i: number) => {
    const view = getView();
    const m = matches[i];
    if (!view || !m) return;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to)).scrollIntoView());
  };
  const step = (d: number) => {
    if (!matches.length) return;
    const n = (cur + d + matches.length) % matches.length;
    setIndex(n);
    show(n);
  };
  const replaceOne = () => {
    const view = getView();
    const m = matches[cur];
    if (!view || !m) return;
    const tr = replace ? view.state.tr.insertText(replace, m.from, m.to) : view.state.tr.delete(m.from, m.to);
    view.dispatch(tr);
    setVersion((v) => v + 1);
  };
  const replaceAll = () => {
    const view = getView();
    if (!view || !matches.length) return;
    const tr = view.state.tr;
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      if (replace) tr.insertText(replace, m.from, m.to); else tr.delete(m.from, m.to);
    }
    view.dispatch(tr);
    useApp.getState().toast(`Replaced ${matches.length} ${matches.length === 1 ? 'match' : 'matches'}.`);
    setVersion((v) => v + 1);
  };

  return (
    <div className={css.find} data-testid="find-panel" onKeyDown={(e) => { if (e.key === 'Escape') { close(); getView()?.focus(); } }}>
      <div className={css.findHead}>
        Find
        <button onClick={() => { close(); getView()?.focus(); }} title="Close" data-testid="find-close"><X size={16} /></button>
      </div>
      <div className={css.findRow}>
        <input ref={input} type="text" className="ud-input" placeholder="Find" value={query} data-testid="find-input"
          onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
          onKeyDown={(e) => { if (e.key === 'Enter') step(e.shiftKey ? -1 : 1); }} />
        <span data-testid="find-count" style={{ minWidth: 54, textAlign: 'center' }}>{matches.length ? `${cur + 1} of ${matches.length}` : '0 of 0'}</span>
        <button onClick={() => step(-1)} title="Previous"><ChevronUp size={16} /></button>
        <button onClick={() => step(1)} title="Next" data-testid="find-next"><ChevronDown size={16} /></button>
      </div>
      <div className={css.findRow}>
        <input type="text" className="ud-input" placeholder="Replace with" value={replace} data-testid="replace-input" onChange={(e) => setReplace(e.target.value)} />
        <button className="ud-btn secondary" onClick={replaceOne} disabled={!matches.length} data-testid="replace-one">Replace</button>
        <button className="ud-btn secondary" onClick={replaceAll} disabled={!matches.length} data-testid="replace-all">All</button>
      </div>
      <div className={css.inline}>
        <Check label="Match case" checked={matchCase} onChange={setMatchCase} />
        <Check label="Whole word" checked={wholeWord} onChange={setWholeWord} />
        <select className="ud-input" value={scope} onChange={(e) => setScope(e.target.value as Scope)} data-testid="find-scope">
          <option value="all">Everything</option><option value="dialogue">Dialogue only</option><option value="action">Action only</option>
        </select>
      </div>
    </div>
  );
}

export function FilterDialog() {
  const close = useApp((s) => s.closeDialog);
  const lines = useMemo(() => currentLines(), []);
  const chars = useMemo(() => characterStats(lines).map((c) => c.name), [lines]);
  const [types, setTypes] = useState<Set<ElementType>>(new Set());
  const [names, setNames] = useState<Set<string>>(new Set());
  const toggle = <T,>(set: Set<T>, v: T) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; };
  const apply = () => {
    const ids: string[] = [];
    let keepSpeech = false;
    for (const l of lines) {
      const typeOk = types.size === 0 || types.has(l.type);
      if (names.size) {
        if (l.type === 'character') keepSpeech = names.has(speakerName(l.text));
        else if (!['dialogue', 'parenthetical', 'lyrics'].includes(l.type)) keepSpeech = false;
        if (keepSpeech && (typeOk || types.size === 0)) ids.push(l.id);
        else if (types.size && typeOk && !['character', 'dialogue', 'parenthetical', 'lyrics'].includes(l.type)) ids.push(l.id);
      } else if (typeOk) ids.push(l.id);
    }
    const label = [types.size ? [...types].map((t) => ELEMENT_LABELS[t]).join(', ') : '', names.size ? [...names].join(', ') : ''].filter(Boolean).join(' / ') || 'Everything';
    useApp.setState({ filter: types.size || names.size ? { label, onlyIds: ids } : null });
    close();
  };
  return (
    <Dialog title="Filter" footer={<>
      <button className="ud-btn secondary" onClick={() => { useApp.setState({ filter: null }); close(); }}>Clear filter</button>
      <button className="ud-btn" onClick={apply} data-testid="filter-apply">Apply</button>
    </>}>
      <p className={css.hint} style={{ marginTop: 0 }}>Show only the lines you choose. Nothing is deleted.</p>
      <Field label="Line types">
        <div className={css.inline}>
          {TOOLBAR_ORDER.filter((t) => t !== 'image').map((t) => <Check key={t} label={ELEMENT_LABELS[t]} checked={types.has(t)} onChange={() => setTypes(toggle(types, t))} testId={`filter-${t}`} />)}
        </div>
      </Field>
      <Field label="Characters">
        <div className={css.inline}>
          {chars.length === 0 && <span className={css.hint}>No characters yet.</span>}
          {chars.map((c) => <Check key={c} label={c} checked={names.has(c)} onChange={() => setNames(toggle(names, c))} />)}
        </div>
      </Field>
    </Dialog>
  );
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** Plan every replacement for renaming a character: character lines and mentions in action and dialogue. */
export function planRename(oldName: string, newName: string): { from: number; to: number; text: string; kind: 'name' | 'mention' }[] {
  const view = getView();
  const O = oldName.trim().toUpperCase();
  const N = newName.trim();
  if (!view || !O || !N) return [];
  const out: { from: number; to: number; text: string; kind: 'name' | 'mention' }[] = [];
  const re = new RegExp(`\\b${escapeRe(O)}\\b`, 'gi');
  view.state.doc.forEach((node, pos) => {
    const text = node.textContent;
    if (node.type.name === 'character') {
      if (speakerName(text) !== O) return;
      const i = text.toUpperCase().indexOf(O);
      if (i >= 0) out.push({ from: pos + 1 + i, to: pos + 1 + i + O.length, text: N.toUpperCase(), kind: 'name' });
      return;
    }
    if (!['action', 'dialogue', 'text', 'parenthetical', 'scene', 'shot', 'note'].includes(elType(node))) return;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      const found = m[0];
      const rep = found === found.toUpperCase() ? N.toUpperCase() : found === found.toLowerCase() ? N.toLowerCase() : titleCase(N);
      out.push({ from: pos + 1 + m.index, to: pos + 1 + m.index + found.length, text: rep, kind: 'mention' });
    }
  });
  return out;
}

export function RenameCharacterDialog() {
  const close = useApp((s) => s.closeDialog);
  const chars = useMemo(() => characterStats(currentLines()).map((c) => c.name), []);
  const [oldName, setOld] = useState(chars[0] ?? '');
  const [newName, setNew] = useState('');
  const plan = useMemo(() => planRename(oldName, newName), [oldName, newName]);
  const names = plan.filter((p) => p.kind === 'name').length;
  const apply = () => {
    const view = getView();
    if (!view || !plan.length) return;
    const tr = view.state.tr;
    for (let i = plan.length - 1; i >= 0; i--) tr.insertText(plan[i].text, plan[i].from, plan[i].to);
    view.dispatch(tr.setMeta('noAuto', true));
    useApp.getState().toast(`Renamed ${oldName} to ${newName.toUpperCase()} in ${plan.length} places.`);
    close();
  };
  return (
    <Dialog title="Rename Character" footer={<>
      <button className="ud-btn secondary" onClick={close}>Cancel</button>
      <button className="ud-btn" onClick={apply} disabled={!plan.length} data-testid="rename-apply">Rename</button>
    </>}>
      <Field label="Character">
        <select className="ud-input" value={oldName} onChange={(e) => setOld(e.target.value)} data-testid="rename-old">
          {chars.length === 0 && <option value="">No characters yet</option>}
          {chars.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="New name"><input className="ud-input" autoFocus value={newName} onChange={(e) => setNew(e.target.value)} data-testid="rename-new" onKeyDown={(e) => { if (e.key === 'Enter') apply(); }} /></Field>
      <div data-testid="rename-preview" className={css.hint}>
        {newName.trim() ? `This will change ${names} character ${names === 1 ? 'line' : 'lines'} and ${plan.length - names} ${plan.length - names === 1 ? 'mention' : 'mentions'} in action and dialogue.` : 'Type the new name to see how many lines will change.'}
      </div>
    </Dialog>
  );
}

export function SpellingDialog() {
  const [items, setItems] = useState<Misspelling[] | null>(null);
  const [sugg, setSugg] = useState<Record<string, string[]>>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const view = getView();
    if (!view) { setItems([]); return; }
    let live = true;
    void checkDocument(view.state.doc).then((ms) => {
      if (!live) return;
      setItems(ms);
      const v = getView();
      if (v) v.dispatch(v.state.tr.setMeta(spellRanges.key, toRanges(ms)).setMeta('addToHistory', false));
    }).catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [tick]);
  const words = useMemo(() => {
    const m = new Map<string, Misspelling[]>();
    for (const i of items ?? []) m.set(i.word, [...(m.get(i.word) ?? []), i]);
    return [...m.entries()];
  }, [items]);
  useEffect(() => {
    for (const [w] of words.slice(0, 40)) if (!sugg[w]) void suggest(w).then((s) => setSugg((x) => ({ ...x, [w]: s })));
  }, [words]);
  const replaceAll = (word: string, rep: string) => {
    const view = getView();
    if (!view) return;
    const tr = view.state.tr;
    const list = (items ?? []).filter((i) => i.word === word).sort((a, b) => b.from - a.from);
    for (const i of list) tr.insert(i.from, schema.text(rep)).delete(i.from + rep.length, i.to + rep.length);
    view.dispatch(tr);
    setTick((t) => t + 1);
  };
  return (
    <Dialog title="Spelling" size="wide">
      {items === null && <div className={css.hint}>Checking spelling...</div>}
      {items !== null && words.length === 0 && <div data-testid="spell-clean">No spelling problems found.</div>}
      {words.length > 0 && (
        <table className={css.table} data-testid="spell-list">
          <thead><tr><th>Word</th><th>Count</th><th>Suggestions</th><th /></tr></thead>
          <tbody>
            {words.map(([w, list]) => (
              <tr key={w}>
                <td><button style={{ textDecoration: 'underline' }} onClick={() => exec(cmd.jumpToLine(list[0].lineId))}>{w}</button></td>
                <td>{list.length}</td>
                <td><div className={css.inline}>{(sugg[w] ?? []).map((s) => <button key={s} className={css.kbd} onClick={() => replaceAll(w, s)}>{s}</button>)}</div></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button style={{ textDecoration: 'underline', marginRight: 10 }} onClick={async () => { await addToDictionary(w); setTick((t) => t + 1); }}>Add to dictionary</button>
                  <button style={{ textDecoration: 'underline' }} onClick={() => { ignoreWord(w); setTick((t) => t + 1); }}>Ignore</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}
