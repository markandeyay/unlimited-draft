import { X } from 'lucide-react';
import { type ReactNode, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { updateActiveDoc } from '../app/project';
import { activeDoc, useApp } from '../app/store';
import * as cmd from '../editor/commands';
import { currentLines, exec, getView } from '../editor/controller';
import { ELEMENT_LABELS, TOOLBAR_ORDER } from '../editor/flow';
import { ELEMENT_SHORTCUTS, SHORTCUT_LABELS } from '../editor/keymap';
import { getLayout } from '../editor/layoutPlugin';
import { computeSceneNumbers } from '../layout/sceneNumbers';
import { defaultPdfOptions, downloadBytes } from '../pdf/util';
import { documentStats, wordCount } from '../reports/analyze';
import { useSettings } from '../settings/settings';
import * as store from '../storage/db';
import type { ElementType } from '../layout/geometry';
import { syncNow } from '../sync/engine';
import { makePdf } from './actions';
import css from './dialogs.module.css';

export function Dialog({ title, tabs, children, footer, size, onClose }: {
  title?: string; tabs?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'wide' | 'xwide'; onClose?: () => void;
}) {
  const close = onClose ?? useApp.getState().closeDialog;
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, []);
  return (
    <div className={css.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className={`${css.dialog} ${size ? css[size] : ''}`} role="dialog" aria-label={title} data-testid="dialog">
        <div className={css.head}>
          {title && <div className={css.title}>{title}</div>}
          {tabs}
          <button className={css.close} onClick={close} title="Close" data-testid="dialog-close"><X size={18} strokeWidth={3} /></button>
        </div>
        <div className={css.body}>{children}</div>
        {footer && <div className={css.foot}>{footer}</div>}
      </div>
    </div>
  );
}

export function Check({ label, checked, onChange, disabled, testId }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; testId?: string }) {
  return (
    <label className={css.check}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span>{label}</span>
    </label>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={css.field}>
      <div className={css.fieldLabel}>{label}</div>
      <div className={css.fieldBody}>{children}</div>
    </div>
  );
}

export function ScriptPreview({ lines, mark }: { lines: { id?: string; type: ElementType; text: string }[]; mark?: (l: { id?: string }) => string | undefined }) {
  return (
    <div className={css.preview}>
      {lines.map((l, i) => (
        <div key={l.id ?? i} className={`${css.pv} ${css[`pv-${l.type}`] ?? ''} ${mark?.(l) ?? ''}`}><span>{l.text || ' '}</span></div>
      ))}
    </div>
  );
}

function PromptDialog({ props }: { props: any }) {
  const [value, setValue] = useState<string>(props.value ?? '');
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    useApp.getState().closeDialog();
    props.resolve(v);
  };
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <Dialog
      title={props.title}
      onClose={() => finish(null)}
      footer={<>
        <button className="ud-btn secondary" onClick={() => finish(null)}>Cancel</button>
        <button className={`ud-btn ${props.danger ? 'danger' : ''}`} onClick={() => finish(value)} data-testid="prompt-ok">{props.confirmText ?? 'OK'}</button>
      </>}
    >
      {props.message && <div style={{ lineHeight: '19px', marginBottom: props.input ? 10 : 0 }}>{props.message}</div>}
      {props.input && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {props.label && <label>{props.label}</label>}
          <input ref={ref} className="ud-input" value={value} data-testid="prompt-input" onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') finish(value); }} />
        </div>
      )}
    </Dialog>
  );
}

function GoToDialog() {
  const [page, setPage] = useState('');
  const [scene, setScene] = useState('');
  const close = useApp((s) => s.closeDialog);
  const total = useApp((s) => s.cursor.total);
  const go = () => {
    const view = getView();
    if (!view) return;
    let target: string | null = null;
    if (scene.trim()) {
      const lines = currentLines();
      const doc = activeDoc();
      const sn = computeSceneNumbers(lines, { locked: !!doc?.sceneNumbers.locked, start: doc?.settings.sceneNumberStart ?? 1 });
      const want = scene.trim().toUpperCase();
      for (const [id, n] of sn) if (n === want) { target = id; break; }
    } else if (page.trim()) {
      const p = Math.max(1, Math.min(total, parseInt(page, 10) || 1)) - 1;
      const info = getLayout(view.state)?.result.info;
      view.state.doc.forEach((n) => { if (!target && (info?.get(n.attrs.id)?.page ?? -1) >= p) target = n.attrs.id; });
    }
    close();
    if (target) setTimeout(() => exec(cmd.jumpToLine(target!)), 20);
    else useApp.getState().toast('Nothing found to go to.');
  };
  return (
    <Dialog title="Go To" footer={<><button className="ud-btn secondary" onClick={close}>Cancel</button><button className="ud-btn" onClick={go} data-testid="goto-ok">Go</button></>}>
      <Field label="Page number"><input className="ud-input" autoFocus inputMode="numeric" value={page} placeholder={`1 to ${total}`} data-testid="goto-page" onChange={(e) => { setPage(e.target.value); setScene(''); }} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} /></Field>
      <Field label="Scene number"><input className="ud-input" value={scene} placeholder="for example 12 or 12A" data-testid="goto-scene" onChange={(e) => { setScene(e.target.value); setPage(''); }} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} /></Field>
    </Dialog>
  );
}

function WordCountDialog() {
  const view = getView();
  const lines = currentLines();
  const total = useApp.getState().cursor.total;
  const st = documentStats(lines, total);
  const sel = view && !view.state.selection.empty ? view.state.doc.textBetween(view.state.selection.from, view.state.selection.to, ' ') : '';
  const chars = lines.reduce((a, l) => a + l.text.length, 0);
  return (
    <Dialog title="Word Count">
      <div className={css.statGrid} data-testid="word-count">
        <div className={css.stat}><b>{st.words.toLocaleString()}</b><span>Words</span></div>
        <div className={css.stat}><b>{chars.toLocaleString()}</b><span>Characters</span></div>
        <div className={css.stat}><b>{st.pages}</b><span>Pages</span></div>
        <div className={css.stat}><b>{st.dialogueWords.toLocaleString()}</b><span>Dialogue words</span></div>
        <div className={css.stat}><b>{st.actionWords.toLocaleString()}</b><span>Action words</span></div>
        {sel && <div className={css.stat}><b>{wordCount(sel).toLocaleString()}</b><span>Words in selection</span></div>}
      </div>
    </Dialog>
  );
}

function ShortcutsDialog() {
  const rows: [string, string][] = [
    ['Open Project', SHORTCUT_LABELS.openProject], ['Save Project (sync now)', SHORTCUT_LABELS.saveProject], ['Set External Backups', SHORTCUT_LABELS.externalBackups],
    ['Print', SHORTCUT_LABELS.print], ['Undo', SHORTCUT_LABELS.undo], ['Redo', `${SHORTCUT_LABELS.redo} or Ctrl+Shift+Z`],
    ['Move Selection Up / Down', `${SHORTCUT_LABELS.moveUp} / ${SHORTCUT_LABELS.moveDown}`], ['Find', SHORTCUT_LABELS.find], ['Go To', SHORTCUT_LABELS.goTo],
    ['Dual Dialogue / Exit Dual', `${SHORTCUT_LABELS.dual} / ${SHORTCUT_LABELS.exitDual}`], ['Full Screen', SHORTCUT_LABELS.fullScreen],
    ['Bold / Italic / Underline', 'Ctrl+B / Ctrl+I / Ctrl+U'], ['Page Break', SHORTCUT_LABELS.pageBreak], ['Select All', SHORTCUT_LABELS.selectAll],
    ['Next element', 'Enter'], ['Switch element', 'Tab (Shift+Tab goes back)'],
    ...TOOLBAR_ORDER.filter((t) => ELEMENT_SHORTCUTS[t]).map((t): [string, string] => [ELEMENT_LABELS[t], ELEMENT_SHORTCUTS[t]!.replace('Mod-', 'Ctrl+')]),
  ];
  return (
    <Dialog title="Keyboard Shortcuts">
      <div className={css.hint} style={{ marginBottom: 8 }}>On a Mac use Cmd in place of Ctrl.</div>
      <table className={css.table}><tbody>
        {rows.map(([a, b]) => <tr key={a}><td>{a}</td><td><span className={css.kbd}>{b}</span></td></tr>)}
      </tbody></table>
    </Dialog>
  );
}

function AboutDialog() {
  return (
    <Dialog title="About Unlimited Draft">
      <p style={{ lineHeight: '20px', marginTop: 0 }}>Unlimited Draft is a personal screenwriting app. Scripts are stored on this device first and committed to a private GitHub repository in the background.</p>
      <p className={css.hint}>Page font: Courier Prime (SIL Open Font License). Icons: Lucide.</p>
    </Dialog>
  );
}

function BackupsDialog() {
  const sync = useApp((s) => s.sync);
  const auth = useApp((s) => s.auth);
  const [repo, setRepo] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void store.db.settings.get('repo').then((r) => setRepo(r?.value ?? '')); }, []);
  return (
    <Dialog title="Set External Backups" footer={<button className="ud-btn" disabled={busy || !auth.login} data-testid="sync-now" onClick={async () => { setBusy(true); await syncNow(); setBusy(false); }}>{busy ? 'Syncing...' : 'Sync now'}</button>}>
      <Field label="Scripts repo">{repo ? <a href={`https://github.com/${repo}`} target="_blank" rel="noreferrer">{repo}</a> : <span>{auth.login ? 'Loading...' : 'Sign in with GitHub to connect the scripts repo.'}</span>}</Field>
      <Field label="Status"><span data-testid="backup-status">{{ synced: 'Everything is in sync.', pending: 'Changes are waiting to be committed.', pushing: 'Committing now.', offline: 'Offline. Changes are saved on this device.', signedout: 'Not signed in. Changes are saved on this device only.', error: `Sync error: ${sync.error ?? ''}` }[sync.state]}</span></Field>
      <Field label="Last commit">
        <span>{sync.lastOnline ? new Date(sync.lastOnline).toLocaleString() : 'None yet in this session'}</span>
        {sync.lastCommitUrl && <a href={sync.lastCommitUrl} target="_blank" rel="noreferrer" data-testid="commit-link">View the last commit on GitHub</a>}
      </Field>
      {!auth.login && <a className="ud-btn" href="/api/auth/login" style={{ textDecoration: 'none' }}>Sign in with GitHub</a>}
      <p className={css.hint}>Every save is committed to the private scripts repo automatically. This replaces Google Drive and Dropbox backups.</p>
    </Dialog>
  );
}

function InsertImageDialog() {
  const close = useApp((s) => s.closeDialog);
  const project = useApp((s) => s.project);
  const pick = async (file: File | undefined) => {
    if (!file || !project) return;
    if (!/^image\/(png|jpe?g)$/.test(file.type)) { useApp.getState().toast('Use a PNG or JPEG image.'); return; }
    const id = store.newId();
    await store.db.assets.put({ id, projectId: project.id, name: file.name, type: file.type, data: await file.arrayBuffer() });
    await store.markDirty(`asset:${id}`);
    close();
    const view = getView();
    if (!view) return;
    cmd.insertElement('image')(view.state, view.dispatch, view);
    const c = cmd.current(view.state);
    view.dispatch(view.state.tr.setNodeMarkup(c.pos, null, { ...c.node.attrs, imageRef: id }));
    view.focus();
  };
  return (
    <Dialog title="Insert Image">
      <label className={css.drop} style={{ display: 'block', cursor: 'pointer' }}>
        Choose a PNG or JPEG image to place in the script.
        <input type="file" accept="image/png,image/jpeg" style={{ display: 'none' }} data-testid="image-file" onChange={(e) => void pick(e.target.files?.[0])} />
      </label>
    </Dialog>
  );
}

function SceneNumbersDialog() {
  const doc = useApp((s) => activeDoc(s));
  const close = useApp((s) => s.closeDialog);
  const [enabled, setEnabled] = useState(!!doc?.sceneNumbers.enabled);
  const [locked, setLocked] = useState(!!doc?.sceneNumbers.locked);
  const [start, setStart] = useState(String(doc?.settings.sceneNumberStart ?? 1));
  const [side, setSide] = useState(doc?.settings.sceneNumberSide ?? 'both');
  if (!doc) return null;
  const apply = async () => {
    const view = getView();
    const st = Math.max(1, parseInt(start, 10) || 1);
    if (view) {
      // Locking stores the current numbers on the scenes; unlocking clears them.
      const lines = currentLines();
      const nums = computeSceneNumbers(lines, { locked: doc.sceneNumbers.locked, start: st });
      const tr = view.state.tr;
      view.state.doc.forEach((n, pos) => {
        if (n.type.name !== 'scene') return;
        const want = locked && enabled ? nums.get(n.attrs.id) ?? null : null;
        if (n.attrs.sceneNumber !== want) tr.setNodeMarkup(pos, null, { ...n.attrs, sceneNumber: want });
      });
      if (tr.docChanged) view.dispatch(tr.setMeta('addToHistory', false).setMeta('noTrack', true));
    }
    await updateActiveDoc((d) => { d.sceneNumbers = { enabled, locked: enabled && locked }; d.settings.sceneNumberStart = st; d.settings.sceneNumberSide = side; });
    close();
  };
  return (
    <Dialog title="Scene Numbers" footer={<><button className="ud-btn secondary" onClick={close}>Cancel</button><button className="ud-btn" onClick={apply} data-testid="scene-numbers-apply">Apply</button></>}>
      <Field label="Numbers"><Check label="Show scene numbers" checked={enabled} onChange={setEnabled} testId="scene-numbers-on" /></Field>
      <Field label="Position">
        <select className="ud-input" value={side} onChange={(e) => setSide(e.target.value as any)}>
          <option value="both">Left and right</option><option value="left">Left</option><option value="right">Right</option>
        </select>
      </Field>
      <Field label="Start at"><input className="ud-input" inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value)} style={{ width: 80 }} /></Field>
      <Field label="Lock">
        <Check label="Lock scene numbers" checked={locked} onChange={setLocked} disabled={!enabled} testId="scene-numbers-lock" />
        <span className={css.hint}>When locked, a new scene between 12 and 13 becomes 12A, then 12B.</span>
      </Field>
    </Dialog>
  );
}

function HeadersFootersDialog() {
  const doc = useApp((s) => activeDoc(s));
  const close = useApp((s) => s.closeDialog);
  const [h, setH] = useState(doc?.settings.header ?? { left: '', center: '', right: '' });
  const [f, setF] = useState(doc?.settings.footer ?? { left: '', center: '', right: '' });
  const row = (v: typeof h, set: (x: typeof h) => void) => (
    <div className={css.inline}>
      {(['left', 'center', 'right'] as const).map((k) => (
        <input key={k} className="ud-input" style={{ flex: 1, minWidth: 80 }} placeholder={k[0].toUpperCase() + k.slice(1)} value={v[k]} onChange={(e) => set({ ...v, [k]: e.target.value })} data-testid={`hf-${k}`} />
      ))}
    </div>
  );
  return (
    <Dialog title="Headers & Footers" footer={<><button className="ud-btn secondary" onClick={close}>Cancel</button><button className="ud-btn" data-testid="hf-apply" onClick={async () => { await updateActiveDoc((d) => { d.settings.header = h; d.settings.footer = f; }); close(); }}>Apply</button></>}>
      <Field label="Header">{row(h, setH)}</Field>
      <Field label="Footer">{row(f, setF)}</Field>
      <p className={css.hint}>Tokens: {'{page}'}, {'{title}'}, {'{date}'}, {'{draft}'}. The page number prints at the top right by default (change it in Customize, Page). Headers and footers appear in the PDF.</p>
    </Dialog>
  );
}

function MoresDialog() {
  const doc = useApp((s) => activeDoc(s));
  const close = useApp((s) => s.closeDialog);
  const s = useSettings((x) => x.settings);
  const set = useSettings((x) => x.set);
  const [cont, setCont] = useState(!!doc?.settings.sceneContinueds);
  return (
    <Dialog title="Mores & Continueds" footer={<button className="ud-btn" onClick={async () => { await updateActiveDoc((d) => { d.settings.sceneContinueds = cont; }); close(); }}>Done</button>}>
      <div className={css.section}>Dialogue</div>
      <Field label="Splitting">
        <Check label="Split dialogue across pages" checked={s.production.splitDialogue} onChange={(v) => set((x) => { x.production.splitDialogue = v; })} />
        <Check label="Split action across pages" checked={s.production.splitAction} onChange={(v) => set((x) => { x.production.splitAction = v; })} />
        <Check label="Split at sentences only" checked={s.production.splitAtSentences} onChange={(v) => set((x) => { x.production.splitAtSentences = v; })} />
      </Field>
      <Field label="MORE text"><input className="ud-input" value={s.production.moreText} onChange={(e) => set((x) => { x.production.moreText = e.target.value; })} /></Field>
      <Field label="CONT'D text"><input className="ud-input" value={s.production.contdText} onChange={(e) => set((x) => { x.production.contdText = e.target.value; })} /></Field>
      <Field label="Automatic"><Check label="Add (CONT'D) when the same character speaks again" checked={s.editing.autoContd} onChange={(v) => set((x) => { x.editing.autoContd = v; })} /></Field>
      <div className={css.section}>Scenes</div>
      <Field label="Continueds"><Check label="(CONTINUED) at the bottom and CONTINUED: at the top when a scene crosses a page" checked={cont} onChange={setCont} testId="scene-continueds" /></Field>
    </Dialog>
  );
}

function ExportDialog() {
  const doc = useApp((s) => activeDoc(s));
  const docs = useApp((s) => s.docs);
  const close = useApp((s) => s.closeDialog);
  const settings = useSettings((s) => s.settings);
  const script = doc && doc.kind !== 'titlePage' ? doc : docs.find((d) => d.kind === 'script');
  const [o, setO] = useState(() => defaultPdfOptions(settings, script));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await makePdf({ ...o, pageFrom: parseInt(from, 10) || undefined, pageTo: parseInt(to, 10) || undefined });
      if (r) downloadBytes(r.bytes, r.name);
      close();
    } finally { setBusy(false); }
  };
  return (
    <Dialog title="Export PDF" footer={<><button className="ud-btn secondary" onClick={close}>Cancel</button><button className="ud-btn" onClick={run} disabled={busy} data-testid="export-go">{busy ? 'Exporting...' : 'Export PDF'}</button></>}>
      <Field label="Include">
        <Check label="Title page" checked={o.includeTitlePage} onChange={(v) => setO({ ...o, includeTitlePage: v })} testId="export-title" />
        <Check label="Scene numbers" checked={o.sceneNumbers} onChange={(v) => setO({ ...o, sceneNumbers: v })} />
        <Check label="Revision asterisks" checked={o.revisionAsterisks} onChange={(v) => setO({ ...o, revisionAsterisks: v })} />
        <Check label="Notes and comments (PDF with notes)" checked={o.includeNotes} onChange={(v) => setO({ ...o, includeNotes: v })} />
      </Field>
      <Field label="Page range">
        <div className={css.inline}>
          <input className="ud-input" style={{ width: 70 }} placeholder="From" inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span>to</span>
          <input className="ud-input" style={{ width: 70 }} placeholder="To" inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value)} />
          <span className={css.hint}>Leave empty for all pages.</span>
        </div>
      </Field>
    </Dialog>
  );
}

const Customize = lazy(() => import('./dialogs/Customize'));
const FindPanel = lazy(() => import('./dialogs/Find').then((m) => ({ default: m.FindPanel })));
const FilterDialog = lazy(() => import('./dialogs/Find').then((m) => ({ default: m.FilterDialog })));
const RenameCharacterDialog = lazy(() => import('./dialogs/Find').then((m) => ({ default: m.RenameCharacterDialog })));
const SpellingDialog = lazy(() => import('./dialogs/Find').then((m) => ({ default: m.SpellingDialog })));
const ReportDialog = lazy(() => import('./dialogs/Reports'));
const RevisionDialogs = lazy(() => import('./dialogs/Revisions'));
const ImportDialog = lazy(() => import('./dialogs/Import'));

export function DialogHost() {
  const dialog = useApp((s) => s.dialog);
  const notice = useApp((s) => s.notice);
  let el: ReactNode = null;
  if (dialog) {
    const p = dialog.props ?? {};
    switch (dialog.name) {
      case 'prompt': el = <PromptDialog key={p.title} props={p} />; break;
      case 'goto': el = <GoToDialog />; break;
      case 'wordCount': el = <WordCountDialog />; break;
      case 'shortcuts': el = <ShortcutsDialog />; break;
      case 'about': el = <AboutDialog />; break;
      case 'backups': el = <BackupsDialog />; break;
      case 'insertImage': el = <InsertImageDialog />; break;
      case 'sceneNumbers': el = <SceneNumbersDialog />; break;
      case 'headersFooters': el = <HeadersFootersDialog />; break;
      case 'mores': el = <MoresDialog />; break;
      case 'export': el = <ExportDialog />; break;
      case 'customize': el = <Customize tab={p.tab} />; break;
      case 'find': el = <FindPanel />; break;
      case 'filter': el = <FilterDialog />; break;
      case 'renameCharacter': el = <RenameCharacterDialog />; break;
      case 'spelling': el = <SpellingDialog />; break;
      case 'report': el = <ReportDialog kind={p.kind} />; break;
      case 'import': el = <ImportDialog />; break;
      case 'lineHistory': case 'viewTrack': case 'acceptReject': case 'dateWriters': case 'timeline': case 'saveSnapshot': case 'snapshots':
        el = <RevisionDialogs name={dialog.name} props={p} />; break;
      default: el = null;
    }
  }
  return (
    <>
      <Suspense fallback={null}>{el}</Suspense>
      {notice && <div className="ud-toast" data-testid="toast" style={{ position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)', background: '#202b33', color: '#fff', padding: '9px 16px', borderRadius: 4, fontSize: 13, boxShadow: '0 4px 16px rgba(0,0,0,.4)', zIndex: 200, maxWidth: '90vw' }}>{notice}</div>}
    </>
  );
}
