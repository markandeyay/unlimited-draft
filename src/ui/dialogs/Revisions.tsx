import { TextSelection } from 'prosemirror-state';
import { useEffect, useMemo, useState } from 'react';
import { updateActiveDoc } from '../../app/project';
import { activeDoc, useApp } from '../../app/store';
import * as cmd from '../../editor/commands';
import { currentLines, exec, flushEditor, getView } from '../../editor/controller';
import { schema, nodeType } from '../../editor/schema';
import { type LineVersion, type Version, lineHistory, listVersions, loadVersion, recordLocalVersion } from '../../history/history';
import * as store from '../../storage/db';
import type { DocumentFile, Line, Snapshot } from '../../storage/models';
import { syncNow } from '../../sync/engine';
import { confirmDialog } from '../actions';
import { Check, Dialog, Field, ScriptPreview } from '../Dialogs';
import css from '../dialogs.module.css';

export const REVISION_COLORS = ['White', 'Blue', 'Pink', 'Yellow', 'Green', 'Goldenrod', 'Buff', 'Salmon', 'Cherry'];
const fmt = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Replace the open document's lines (restore) and reload the editor. */
async function restoreLines(lines: Line[]) {
  const doc = activeDoc();
  if (doc) await recordLocalVersion({ ...doc, lines: currentLines() }, true);
  await updateActiveDoc((d) => { d.lines = lines.map((l) => ({ ...l, updatedAt: store.nowIso() })); }, { reload: true });
}

function ViewTrack() {
  const doc = useApp((s) => activeDoc(s));
  const close = useApp((s) => s.closeDialog);
  const [on, setOn] = useState(!!doc?.revision.tracking);
  const [color, setColor] = useState(doc?.revision.color ?? 'Blue');
  if (!doc) return null;
  const apply = async () => {
    await flushEditor();
    const lines = currentLines();
    await updateActiveDoc((d) => {
      const starting = on && !d.revision.tracking;
      d.revision = {
        ...d.revision, tracking: on, color,
        ...(starting || !d.revision.base ? { base: Object.fromEntries(lines.map((l) => [l.id, { type: l.type, text: l.text }])), baseOrder: lines.map((l) => l.id), startedAt: store.nowIso() } : {}),
      };
    });
    close();
  };
  const clear = async () => {
    const view = getView();
    if (!view) return;
    const tr = view.state.tr;
    view.state.doc.forEach((n, pos) => { if (n.attrs.revisionMarked || n.attrs.revisionColor) tr.setNodeMarkup(pos, null, { ...n.attrs, revisionMarked: false, revisionColor: null }); });
    view.dispatch(tr.setMeta('noTrack', true));
    useApp.getState().toast('All revision marks cleared.');
  };
  return (
    <Dialog title="View & Track" footer={<><button className="ud-btn secondary" onClick={clear}>Clear all marks</button><button className="ud-btn" onClick={apply} data-testid="track-apply">Apply</button></>}>
      <Field label="Tracking"><Check label="Track revisions" checked={on} onChange={setOn} testId="track-on" /></Field>
      <Field label="Revision color">
        <select className="ud-input" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 160 }} data-testid="track-color">
          {REVISION_COLORS.map((c) => <option key={c}>{c}</option>)}
        </select>
      </Field>
      <p className={css.hint}>While tracking is on, every changed or added line is tinted with the revision color and gets an asterisk in the right margin. Asterisks also print in the PDF.</p>
    </Dialog>
  );
}

interface Change { id: string; kind: 'changed' | 'added' | 'deleted'; before?: string; after?: string; type: string }

function AcceptReject() {
  const doc = useApp((s) => activeDoc(s));
  const [tick, setTick] = useState(0);
  const [i, setI] = useState(0);
  const changes = useMemo<Change[]>(() => {
    if (!doc) return [];
    const base = doc.revision.base ?? {};
    const lines = currentLines();
    const now = new Set(lines.map((l) => l.id));
    const out: Change[] = [];
    for (const l of lines) {
      if (!l.revisionMarked && !l.revisionColor) continue;
      const b = base[l.id];
      out.push(b ? { id: l.id, kind: 'changed', before: b.text, after: l.text, type: l.type } : { id: l.id, kind: 'added', after: l.text, type: l.type });
    }
    if (doc.revision.base) for (const id of doc.revision.baseOrder ?? []) {
      const b = base[id];
      if (b && !now.has(id)) out.push({ id, kind: 'deleted', before: b.text, type: b.type });
    }
    return out;
  }, [doc, tick]);
  if (!doc) return null;
  const c = changes[Math.min(i, changes.length - 1)];
  const find = (id: string) => { const v = getView(); let r: { pos: number; node: any } | null = null; v?.state.doc.forEach((n, pos) => { if (n.attrs.id === id) r = { pos, node: n }; }); return r as { pos: number; node: any } | null; };

  const accept = (ch: Change) => {
    const view = getView();
    if (!view) return;
    if (ch.kind === 'deleted') {
      void updateActiveDoc((d) => { if (d.revision.base) { d.revision.base = { ...d.revision.base }; delete d.revision.base[ch.id]; } });
    } else {
      const f = find(ch.id);
      if (f) view.dispatch(view.state.tr.setNodeMarkup(f.pos, null, { ...f.node.attrs, revisionMarked: false, revisionColor: null }).setMeta('noTrack', true));
    }
  };
  const reject = (ch: Change) => {
    const view = getView();
    if (!view) return;
    const base = doc.revision.base ?? {};
    if (ch.kind === 'added') {
      const f = find(ch.id);
      if (f && view.state.doc.childCount > 1) view.dispatch(view.state.tr.delete(f.pos, f.pos + f.node.nodeSize).setMeta('noTrack', true));
    } else if (ch.kind === 'changed') {
      const f = find(ch.id);
      const b = base[ch.id];
      if (f && b) {
        const node = nodeType(b.type).create({ ...f.node.attrs, revisionMarked: false, revisionColor: null }, b.text ? schema.text(b.text) : undefined);
        view.dispatch(view.state.tr.replaceWith(f.pos, f.pos + f.node.nodeSize, node).setMeta('noTrack', true));
      }
    } else {
      // Put the deleted line back after the line that used to be before it.
      const order = doc.revision.baseOrder ?? [];
      const b = base[ch.id];
      if (!b) return;
      let at = 0;
      for (let k = order.indexOf(ch.id) - 1; k >= 0; k--) { const f = find(order[k]); if (f) { at = f.pos + f.node.nodeSize; break; } }
      const node = nodeType(b.type).create({ id: ch.id, createdAt: store.nowIso(), updatedAt: store.nowIso() }, b.text ? schema.text(b.text) : undefined);
      view.dispatch(view.state.tr.insert(at, node).setMeta('noTrack', true));
    }
  };
  const act = (fn: (c: Change) => void, all: boolean) => {
    for (const ch of all ? changes : c ? [c] : []) fn(ch);
    setTimeout(() => setTick((t) => t + 1), 80);
  };
  return (
    <Dialog title="Accept/Reject" footer={<>
      <button className="ud-btn secondary" onClick={() => act(reject, true)} disabled={!changes.length}>Reject all</button>
      <button className="ud-btn secondary" onClick={() => act(accept, true)} disabled={!changes.length} data-testid="accept-all">Accept all</button>
    </>}>
      {changes.length === 0 ? <div data-testid="no-changes">There are no tracked changes.</div> : c && (
        <>
          <div className={css.inline} style={{ marginBottom: 10, justifyContent: 'space-between' }}>
            <span data-testid="change-count">Change {Math.min(i, changes.length - 1) + 1} of {changes.length} ({c.kind})</span>
            <span className={css.inline}>
              <button className="ud-btn secondary" onClick={() => setI((x) => (x - 1 + changes.length) % changes.length)}>Previous</button>
              <button className="ud-btn secondary" onClick={() => setI((x) => (x + 1) % changes.length)}>Next</button>
            </span>
          </div>
          <div className={css.preview} style={{ minHeight: 0 }} onClick={() => c.kind !== 'deleted' && exec(cmd.jumpToLine(c.id), false)}>
            {c.before !== undefined && <div className={`${css.pv} ${css.pvDel}`}><span>{c.before || ' '}</span></div>}
            {c.after !== undefined && <div className={`${css.pv} ${css.pvAdd}`}><span>{c.after || ' '}</span></div>}
          </div>
          <div className={css.inline} style={{ marginTop: 10 }}>
            <button className="ud-btn" onClick={() => act(accept, false)} data-testid="accept-one">Accept</button>
            <button className="ud-btn danger" onClick={() => act(reject, false)} data-testid="reject-one">Reject</button>
          </div>
        </>
      )}
    </Dialog>
  );
}

function DateWriters() {
  const doc = useApp((s) => activeDoc(s));
  const close = useApp((s) => s.closeDialog);
  const cursor = useApp((s) => s.cursor.lineId);
  const [lines, setLines] = useState<Line[]>([]);
  useEffect(() => { void flushEditor().then(() => setLines([...(activeDoc()?.lines ?? [])])); }, []);
  if (!doc) return null;
  const cur = lines.find((l) => l.id === cursor);
  const recent = [...lines].filter((l) => l.text.trim()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 60);
  return (
    <Dialog title="Date & Writers" size="wide">
      {cur && <p style={{ marginTop: 0 }} data-testid="date-current">Current line last changed {fmt(cur.updatedAt)} by Markandeya{cur.device ? ` on ${cur.device}` : ''}.</p>}
      <table className={css.table}>
        <thead><tr><th>Last changed</th><th>Writer</th><th>Device</th><th>Line</th></tr></thead>
        <tbody>
          {recent.map((l) => (
            <tr key={l.id} className={css.click} onClick={() => { close(); setTimeout(() => exec(cmd.jumpToLine(l.id)), 20); }}>
              <td style={{ whiteSpace: 'nowrap' }}>{fmt(l.updatedAt)}</td><td>Markandeya</td><td>{l.device ?? ''}</td><td>{l.text.slice(0, 70)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}

function LineHistory({ lineId }: { lineId: string }) {
  const project = useApp((s) => s.project);
  const close = useApp((s) => s.closeDialog);
  const [items, setItems] = useState<LineVersion[] | null>(null);
  useEffect(() => {
    void (async () => {
      await flushEditor();
      const doc = activeDoc();
      if (!doc || !project) { setItems([]); return; }
      setItems(await lineHistory(project, doc, lineId));
    })();
  }, [lineId]);
  const restore = (v: LineVersion) => {
    const view = getView();
    if (!view) return;
    view.state.doc.forEach((n, pos) => {
      if (n.attrs.id !== lineId) return;
      const node = nodeType(v.type).create(n.attrs, v.text ? schema.text(v.text) : undefined);
      const tr = view.state.tr.replaceWith(pos, pos + n.nodeSize, node);
      tr.setSelection(TextSelection.create(tr.doc, pos + 1));
      view.dispatch(tr);
    });
    close();
    view.focus();
  };
  return (
    <Dialog title="Current Line's History" size="wide">
      {items === null && <div className={css.hint}>Loading history...</div>}
      {items && items.length <= 1 && <div className={css.hint} data-testid="line-history-empty">This line has no earlier versions yet. Versions are recorded as you save and sync.</div>}
      <div data-testid="line-history">
        {(items ?? []).map((v, i) => (
          <div key={i} className={css.listItem}>
            <div>
              <div style={{ fontFamily: '"Courier Prime", monospace', overflowWrap: 'anywhere' }}>{v.text || '(empty)'}</div>
              <div className={css.hint}>{fmt(v.at)} / {v.source}</div>
            </div>
            {i > 0 && <button className="ud-btn secondary" onClick={() => restore(v)}>Restore</button>}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

function Timeline() {
  const project = useApp((s) => s.project);
  const close = useApp((s) => s.closeDialog);
  const [versions, setVersions] = useState<Version[]>([]);
  const [i, setI] = useState(0);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [doc, setDoc] = useState<DocumentFile | null>(null);
  useEffect(() => {
    void (async () => {
      await flushEditor();
      const d = activeDoc();
      if (!d || !project) return;
      setDoc(d);
      const vs = [...(await listVersions(project, d)), { key: 'current', at: store.nowIso(), label: 'Now', source: 'current' as const }];
      setVersions(vs);
      setI(vs.length - 1);
    })();
  }, []);
  useEffect(() => {
    const v = versions[i];
    if (!v || !doc || !project) return;
    let live = true;
    setLines(null);
    void loadVersion(project, doc, v).then((l) => { if (live) setLines(l ?? []); }).catch(() => { if (live) setLines([]); });
    return () => { live = false; };
  }, [i, versions]);
  const v = versions[i];
  return (
    <Dialog title="Timeline View" size="wide" footer={<button className="ud-btn" disabled={!v || v.source === 'current' || !lines?.length} data-testid="timeline-restore" onClick={async () => { if (lines) { await restoreLines(lines); close(); } }}>Restore this version</button>}>
      <input type="range" min={0} max={Math.max(0, versions.length - 1)} value={i} onChange={(e) => setI(parseInt(e.target.value, 10))} style={{ width: '100%' }} data-testid="timeline-slider" />
      <div className={css.inline} style={{ justifyContent: 'space-between', margin: '6px 0 10px' }}>
        <span data-testid="timeline-label">{v ? `${fmt(v.at)} / ${v.label}` : 'No versions yet'}</span>
        <span className={css.hint}>{versions.length ? `${i + 1} of ${versions.length}` : ''}</span>
      </div>
      {lines === null ? <div className={css.hint}>Loading...</div> : <ScriptPreview lines={lines} />}
    </Dialog>
  );
}

function SaveSnapshot() {
  const close = useApp((s) => s.closeDialog);
  const project = useApp((s) => s.project);
  const [name, setName] = useState(`Draft ${new Date().toLocaleDateString()}`);
  const save = async () => {
    await flushEditor();
    const doc = activeDoc();
    if (!doc || !project) return;
    const snap: Snapshot & { projectId: string } = { id: store.newId(), name: name.trim() || 'Snapshot', docId: doc.id, at: store.nowIso(), lines: doc.lines.map((l) => ({ ...l })), projectId: project.id };
    await store.db.snapshots.put(snap);
    await store.markDirty(`snapshots:${project.id}`, `doc:${doc.id}`);
    close();
    useApp.getState().toast(`Snapshot "${snap.name}" saved.`);
    const ok = await syncNow(`Snapshot: ${snap.name}`);
    if (ok) {
      const meta = (await store.db.settings.get('syncMeta'))?.value;
      if (meta?.headSha) await store.db.snapshots.update(snap.id, { sha: meta.headSha });
    }
  };
  return (
    <Dialog title="Save Snapshot" footer={<><button className="ud-btn secondary" onClick={close}>Cancel</button><button className="ud-btn" onClick={save} data-testid="snapshot-save">Save snapshot</button></>}>
      <Field label="Name"><input className="ud-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} data-testid="snapshot-name" onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} /></Field>
      <p className={css.hint}>A snapshot is a named version you can open, compare with the current script, or restore later.</p>
    </Dialog>
  );
}

function Snapshots() {
  const project = useApp((s) => s.project);
  const close = useApp((s) => s.closeDialog);
  const [list, setList] = useState<(Snapshot & { projectId: string })[]>([]);
  const [open, setOpen] = useState<{ snap: Snapshot; lines: Line[]; mode: 'view' | 'compare' } | null>(null);
  const [tick, setTick] = useState(0);
  const cur = useMemo(() => currentLines(), [open]);
  useEffect(() => {
    const d = activeDoc();
    if (!d) return;
    void store.db.snapshots.where('docId').equals(d.id).toArray().then((l) => setList(l.sort((a, b) => b.at.localeCompare(a.at))));
  }, [tick]);
  const load = async (s: Snapshot, mode: 'view' | 'compare') => {
    let lines = s.lines;
    const d = activeDoc();
    if (!lines && s.sha && project && d) lines = (await loadVersion(project, d, { key: `commit:${s.sha}`, at: s.at, label: s.name, source: 'commit', sha: s.sha })) ?? undefined;
    if (!lines) { useApp.getState().toast('This snapshot needs a connection to load.'); return; }
    setOpen({ snap: s, lines, mode });
  };
  if (open) {
    const snapIds = new Map(open.lines.map((l) => [l.id, l]));
    const curIds = new Map(cur.map((l) => [l.id, l]));
    return (
      <Dialog title={`${open.mode === 'compare' ? 'Compare' : 'Snapshot'}: ${open.snap.name}`} size={open.mode === 'compare' ? 'xwide' : 'wide'} footer={<>
        <button className="ud-btn secondary" onClick={() => setOpen(null)}>Back</button>
        <button className="ud-btn" data-testid="snapshot-restore" onClick={async () => { if (await confirmDialog('Restore Snapshot', `Replace the current document with "${open.snap.name}"? The current version stays in the history.`, 'Restore')) { await restoreLines(open.lines); close(); } }}>Restore</button>
      </>}>
        {open.mode === 'view' ? <ScriptPreview lines={open.lines} /> : (
          <div className={css.cols} data-testid="snapshot-compare">
            <div><div className={css.hint} style={{ marginBottom: 4 }}>{open.snap.name} ({fmt(open.snap.at)})</div>
              <ScriptPreview lines={open.lines} mark={(l) => (!curIds.has(l.id!) ? css.pvDel : curIds.get(l.id!)!.text !== snapIds.get(l.id!)!.text ? css.pvChg : undefined)} /></div>
            <div><div className={css.hint} style={{ marginBottom: 4 }}>Current</div>
              <ScriptPreview lines={cur} mark={(l) => (!snapIds.has(l.id!) ? css.pvAdd : snapIds.get(l.id!)!.text !== curIds.get(l.id!)!.text ? css.pvChg : undefined)} /></div>
          </div>
        )}
      </Dialog>
    );
  }
  return (
    <Dialog title="Document Snapshots" size="wide">
      {list.length === 0 && <div className={css.hint} data-testid="snapshots-empty">No snapshots yet. Use Revisions, Save Snapshot to make one.</div>}
      {list.map((s) => (
        <div key={s.id} className={css.listItem} data-testid="snapshot-item">
          <div><div style={{ fontWeight: 600 }}>{s.name}</div><div className={css.hint}>{fmt(s.at)}{s.sha ? ` / commit ${s.sha.slice(0, 7)}` : ''}</div></div>
          <button className="ud-btn secondary" onClick={() => void load(s, 'view')}>Open</button>
          <button className="ud-btn secondary" onClick={() => void load(s, 'compare')} data-testid="snapshot-compare-btn">Compare</button>
          <button className="ud-btn secondary" onClick={async () => { await store.db.snapshots.delete(s.id); if (project) await store.markDirty(`snapshots:${project.id}`); setTick((t) => t + 1); }}>Delete</button>
        </div>
      ))}
    </Dialog>
  );
}

export default function RevisionDialogs({ name, props }: { name: string; props: any }) {
  switch (name) {
    case 'viewTrack': return <ViewTrack />;
    case 'acceptReject': return <AcceptReject />;
    case 'dateWriters': return <DateWriters />;
    case 'lineHistory': return <LineHistory lineId={props.lineId} />;
    case 'timeline': return <Timeline />;
    case 'saveSnapshot': return <SaveSnapshot />;
    case 'snapshots': return <Snapshots />;
    default: return null;
  }
}
