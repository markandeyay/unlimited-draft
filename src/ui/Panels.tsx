import {
  Bold, ChartColumn, ChevronDown, CircleCheck, EllipsisVertical, ExternalLink, FileDown, FilePlus2, FileText, FileUp, FolderOpen, HardDrive,
  History, Italic, LoaderCircle, LogOut, MapPin, MessageCircle, Moon, NotebookPen, Plus, Redo2, Save, ScrollText, SpellCheck, Strikethrough,
  Sun, Underline, Undo2, WholeWord, type LucideIcon,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../app/store';
import * as cmd from '../editor/commands';
import { currentLines, exec, getView } from '../editor/controller';
import { commentRanges } from '../editor/rangePlugin';
import { type SceneInfo, splitScenes } from '../reports/analyze';
import { useSettings } from '../settings/settings';
import * as store from '../storage/db';
import type { Comment, DocumentFile } from '../storage/models';
import { actions } from './actions';
import { MenuList } from './MenuBar';
import css from './shell.module.css';

function PanelShell({ title, menu, children, footer }: { title: string; menu?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <>
      <div className={css.panelHead}>
        <ChevronDown size={11} fill="currentColor" style={{ transform: 'rotate(45deg)', flex: 'none' }} />
        <span title={title}>{title}</span>
        {menu}
      </div>
      <div className={css.panelBody}>{children}</div>
      {footer}
    </>
  );
}

export function Row({ icon: Icon, label, onClick, active, right, testId }: { icon?: LucideIcon; label: string; onClick?: () => void; active?: boolean; right?: ReactNode; testId?: string }) {
  return (
    <button className={`${css.row} ${active ? css.rowActive : ''}`} onClick={onClick} title={label} data-testid={testId}>
      {Icon && <Icon size={17} strokeWidth={1.9} />}
      <span className={css.rowLabel}>{label}</span>
      {right}
    </button>
  );
}

function Kebab({ items }: { items: Parameters<typeof MenuList>[0]['items'] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex' }}>
      <span role="button" className={css.panelHeadBtn} onClick={(e) => { e.stopPropagation(); setOpen(!open); }} data-testid="kebab">
        <EllipsisVertical size={15} />
      </span>
      {open && <div style={{ position: 'absolute', top: 22, left: 0, zIndex: 50 }}><MenuList items={items} onClose={() => setOpen(false)} /></div>}
    </div>
  );
}

const fmtTime = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'never');

export function SaveStatus() {
  const sync = useApp((s) => s.sync);
  const color = sync.state === 'synced' ? 'var(--ok)' : sync.state === 'pushing' ? 'var(--accent)' : sync.state === 'error' ? 'var(--danger)' : 'var(--warn)';
  const label = { synced: 'In sync', pending: 'Changes waiting to sync', pushing: 'Syncing', offline: 'Offline, changes pending', signedout: 'Not signed in', error: sync.error ?? 'Sync error' }[sync.state];
  return (
    <div className={css.status} title={label} data-testid="save-status" data-state={sync.state}>
      <span className={css.statusIcon}>
        {sync.state === 'pushing' ? <LoaderCircle size={17} className={css.spin} /> : <Save size={17} strokeWidth={1.8} />}
        {sync.state === 'synced'
          ? <CircleCheck size={11} fill="var(--ok)" color="var(--panel)" style={{ position: 'absolute', right: -5, bottom: -4 }} />
          : sync.state !== 'pushing' && <span className={css.statusBadge} style={{ background: color }} />}
      </span>
      <span>
        Last saved online: {fmtTime(sync.lastOnline)}
        <br />
        Last saved offline: {fmtTime(sync.lastOffline)}
      </span>
    </div>
  );
}

const DOC_ICON: Record<DocumentFile['kind'], LucideIcon> = { script: FileText, pad: NotebookPen, titlePage: ScrollText, custom: FileText };

export function ProjectPanel() {
  const project = useApp((s) => s.project);
  const docs = useApp((s) => s.docs);
  const active = useApp((s) => s.activeDocId);
  if (!project) return null;
  return (
    <PanelShell
      title={project.name}
      menu={<Kebab items={[
        { label: 'Rename Project...', action: actions.renameProject },
        { label: 'Duplicate Project...', action: actions.duplicateProject },
        { label: 'Remove Project...', action: actions.removeProject },
      ]} />}
      footer={<SaveStatus />}
    >
      <div className={css.panelTitle}>Project Documents</div>
      {docs.map((d) => (
        <Row
          key={d.id}
          icon={DOC_ICON[d.kind]}
          label={d.name}
          active={d.id === active}
          testId={`doc-${d.kind}`}
          onClick={() => actions.switchDocument(d.id)}
          right={d.kind === 'custom' ? (
            <span className={css.rowMenu} onClick={(e) => e.stopPropagation()}>
              <Kebab items={[{ label: 'Rename...', action: () => actions.renameDocument(d) }, { label: 'Remove...', action: () => actions.removeDocument(d) }]} />
            </span>
          ) : undefined}
        />
      ))}
      <Row icon={Plus} label="Add Document" onClick={actions.addDocument} />
      <div className={css.divider} />
      <Row icon={FileUp} label="Import" onClick={actions.importFile} />
      <Row icon={FileDown} label="Export" onClick={actions.exportDialog} />
      <Row icon={FileText} label="Quick Export (PDF)" onClick={actions.quickExport} testId="quick-export" />
      <div className={css.divider} />
      <Row icon={FilePlus2} label="New Project" onClick={actions.newProject} />
      <Row icon={FolderOpen} label="Open" onClick={actions.openLibrary} testId="open-library" />
      <div className={css.divider} />
      <Row icon={HardDrive} label="Set External Backups" onClick={actions.externalBackups} />
    </PanelShell>
  );
}

/** Scene cards. Used in the narrow panel and full width in Card View. */
export function Cards({ wide = false }: { wide?: boolean }) {
  const docVersion = useApp((s) => s.docVersion);
  const activeDocId = useApp((s) => s.activeDocId);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const scenes = useMemo(() => splitScenes(currentLines()), [docVersion, activeDocId, tick]);

  const open = (s: SceneInfo) => {
    useApp.setState({ viewMode: 'page' });
    setTimeout(() => exec(cmd.jumpToLine(s.id)), 30);
  };
  const drop = (target: SceneInfo) => {
    if (!drag || drag === target.id) return;
    moveScene(drag, target.id);
    setDrag(null);
    setOver(null);
    setTimeout(() => setTick((t) => t + 1), 20);
  };
  let lastSeq: string | undefined;
  return (
    <div className={wide ? css.cardsGrid : css.cardsPanel} data-testid="cards">
      {scenes.length === 0 && <div className={css.empty} style={wide ? { gridColumn: '1 / -1' } : undefined}>No scenes yet. Add a scene heading to see cards.</div>}
      {scenes.map((s, i) => {
        const seq = s.sequence !== lastSeq ? s.sequence : undefined;
        lastSeq = s.sequence;
        return (
          <div key={s.id} style={{ display: 'contents' }}>
            {seq && wide && <div className={css.cardSeq}>{seq}</div>}
            <div
              className={`${css.card} ${over === s.id ? css.cardDrop : ''}`}
              draggable
              data-testid="card"
              onDragStart={() => setDrag(s.id)}
              onDragOver={(e) => { e.preventDefault(); setOver(s.id); }}
              onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
              onDrop={(e) => { e.preventDefault(); drop(s); }}
              onClick={() => open(s)}
            >
              <div className={css.cardHead}><span>{i + 1}</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.heading}</span></div>
              <div className={css.cardBody}>{s.body.filter((l) => l.text.trim()).slice(0, wide ? 5 : 2).map((l) => (l.type === 'character' ? l.text.toUpperCase() : l.text)).join('\n')}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Move the scene starting at `fromId` so it sits before the scene `beforeId`. */
export function moveScene(fromId: string, beforeId: string) {
  const view = getView();
  if (!view) return;
  const doc = view.state.doc;
  const idx = (id: string) => { let r = -1; doc.forEach((n, _p, i) => { if (n.attrs.id === id) r = i; }); return r; };
  const a = cmd.sceneRange(view.state, idx(fromId));
  const b = cmd.sceneRange(view.state, idx(beforeId));
  if (!a || !b) return;
  const slice = doc.slice(a.from, a.to);
  const tr = view.state.tr;
  if (a.from < b.from) { tr.insert(b.from, slice.content); tr.delete(a.from, a.to); }
  else { tr.delete(a.from, a.to); tr.insert(b.from, slice.content); }
  view.dispatch(tr);
}

export function CardsPanel() {
  return (
    <PanelShell title="Cards">
      <Row icon={Plus} label="New Sequence" onClick={actions.insertSequence} />
      <div className={css.divider} />
      <Cards />
    </PanelShell>
  );
}

/** Keeps comment highlights in the script in step with the comment list. */
export function useCommentHighlights() {
  const docId = useApp((s) => s.activeDocId);
  const docVersion = useApp((s) => s.docVersion);
  const [comments, setComments] = useState<Comment[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!docId) { setComments([]); return; }
    void store.listComments(docId).then(setComments);
  }, [docId, tick]);
  useEffect(() => {
    const t = setTimeout(() => {
      const view = getView();
      if (!view) return;
      const byLine = new Map<string, Comment[]>();
      for (const c of comments) if (!c.resolved) byLine.set(c.lineId, [...(byLine.get(c.lineId) ?? []), c]);
      const ranges: { from: number; to: number; cls: string; attrs?: Record<string, string> }[] = [];
      view.state.doc.forEach((node, pos) => {
        for (const c of byLine.get(node.attrs.id) ?? []) {
          const size = node.content.size;
          const from = Math.min(c.from ?? 0, size), to = Math.min(c.to ?? size, size);
          if (to > from) ranges.push({ from: pos + 1 + from, to: pos + 1 + to, cls: 'cmt', attrs: { 'data-comment': c.id } });
          else if (size > 0) ranges.push({ from: pos + 1, to: pos + 1 + size, cls: 'cmt', attrs: { 'data-comment': c.id } });
        }
      });
      view.dispatch(view.state.tr.setMeta(commentRanges.key, ranges).setMeta('addToHistory', false));
    }, 60);
    return () => clearTimeout(t);
  }, [comments, docId, docVersion === 0]);
  return { comments, reload: () => setTick((t) => t + 1) };
}

export function CommentsPanel({ comments, reload }: { comments: Comment[]; reload: () => void }) {
  const docId = useApp((s) => s.activeDocId);
  const project = useApp((s) => s.project);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const add = async () => {
    const view = getView();
    if (!view || !docId || !project || !draft.trim()) return;
    const { $from, $to, empty } = view.state.selection;
    const node = $from.node(1);
    if (!node) return;
    const sameLine = $to.node(1) === node;
    const from = empty ? 0 : $from.parentOffset;
    const to = empty ? node.content.size : sameLine ? $to.parentOffset : node.content.size;
    const at = store.nowIso();
    await store.putComment({
      id: store.newId(), docId, projectId: project.id, lineId: node.attrs.id, from, to,
      quote: node.textContent.slice(from, to).slice(0, 80), text: draft.trim(), createdAt: at, updatedAt: at, resolved: false,
    });
    setDraft('');
    reload();
  };

  return (
    <PanelShell title="Comments">
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <textarea
          className="ud-input"
          rows={3}
          placeholder="Comment on the current line or selection"
          value={draft}
          data-testid="comment-input"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void add(); }}
        />
        <button className="ud-btn" onClick={add} disabled={!draft.trim()} data-testid="comment-add">Add comment</button>
      </div>
      {comments.length === 0 && <div className={css.empty}>There are no comments on this document</div>}
      {comments.map((c) => (
        <div key={c.id} className={`${css.comment} ${c.resolved ? css.commentResolved : ''}`} data-testid="comment" onClick={() => exec(cmd.jumpToLine(c.lineId, c.from ?? 0))}>
          {c.quote && <div className={css.commentQuote}>"{c.quote}"</div>}
          {editing === c.id ? (
            <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <textarea className="ud-input" rows={3} value={editText} onChange={(e) => setEditText(e.target.value)} />
              <button className="ud-btn" onClick={async () => { await store.putComment({ ...c, text: editText.trim() || c.text }); setEditing(null); reload(); }}>Save</button>
            </div>
          ) : <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{c.text}</div>}
          <div className={css.commentMeta} onClick={(e) => e.stopPropagation()}>
            <span>{new Date(c.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            <button onClick={() => { setEditing(c.id); setEditText(c.text); }}>Edit</button>
            <button onClick={async () => { await store.putComment({ ...c, resolved: !c.resolved }); reload(); }}>{c.resolved ? 'Reopen' : 'Resolve'}</button>
            <button onClick={async () => { await store.deleteComment(c); reload(); }}>Delete</button>
          </div>
        </div>
      ))}
    </PanelShell>
  );
}

export function AnalysisPanel() {
  return (
    <PanelShell title="Analysis">
      <Row icon={ChartColumn} label="Document Stats" onClick={() => actions.report('stats')} />
      <Row icon={SpellCheck} label="Check Spelling" onClick={actions.spelling} />
      <Row icon={WholeWord} label="Word Count" onClick={actions.wordCount} />
      <div className={css.divider} />
      <Row icon={MapPin} label="Locations" onClick={() => actions.report('locations')} />
      <Row icon={MessageCircle} label="Dialogue" onClick={() => actions.report('dialogue')} />
    </PanelShell>
  );
}

export function ToolsPanel() {
  const cur = useApp((s) => s.cursor);
  return (
    <PanelShell title="Tools">
      <Row icon={Bold} label="Bold" active={cur.bold} onClick={actions.bold} />
      <Row icon={Italic} label="Italic" active={cur.italic} onClick={actions.italic} />
      <Row icon={Underline} label="Underline" active={cur.underline} onClick={actions.underline} />
      <Row icon={Strikethrough} label="Strikethrough" active={cur.strike} onClick={actions.strike} />
      <Row icon={Undo2} label="Undo" onClick={actions.undo} />
      <Row icon={Redo2} label="Redo" onClick={actions.redo} />
      <div className={css.sectionHead}>
        <ChevronDown size={11} fill="currentColor" style={{ transform: 'rotate(45deg)' }} />
        Revisions
      </div>
      <Row icon={History} label="Line's History" onClick={actions.lineHistory} />
      <Row label="View & Track" onClick={actions.viewTrack} />
      <Row label="Accept/Reject" onClick={actions.acceptReject} />
      <Row label="Date & Writers" onClick={actions.dateWriters} />
      <Row label="Mark Change" onClick={actions.markChange} />
      <Row label="Unmark Change" onClick={actions.unmarkChange} />
      <Row label="Timeline View" onClick={actions.timeline} />
      <Row label="Save Snapshot" onClick={actions.saveSnapshot} />
      <Row label="Document Snapshots" onClick={actions.snapshots} />
    </PanelShell>
  );
}

export function AccountPanel() {
  const auth = useApp((s) => s.auth);
  const dark = useSettings((s) => s.settings.display.darkMode);
  const [repo, setRepo] = useState('');
  useEffect(() => { void store.db.settings.get('repo').then((r) => setRepo(r?.value ?? '')); }, [auth.login]);
  return (
    <PanelShell title="Account" footer={<SaveStatus />}>
      <div style={{ padding: '14px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: '#fff', textAlign: 'center' }}>
        <div className={css.avatar} style={{ width: 48, height: 48, fontSize: 18 }}>
          {auth.avatar ? <img src={auth.avatar} alt="" /> : 'MY'}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>{auth.login ?? 'Not signed in'}</div>
      </div>
      {!auth.login && <div style={{ padding: '0 8px 10px' }}><a className="ud-btn" style={{ width: '100%', textDecoration: 'none' }} href="/api/auth/login" data-testid="sign-in">Sign in with GitHub</a></div>}
      <Row icon={dark ? Sun : Moon} label={dark ? 'Light page' : 'Dark page'} onClick={actions.toggleDark} />
      {repo && <Row icon={ExternalLink} label="Scripts repo" onClick={() => window.open(`https://github.com/${repo}`, '_blank', 'noopener')} />}
      {auth.login && (
        <Row icon={LogOut} label="Sign out" onClick={async () => {
          await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
          location.reload();
        }} />
      )}
    </PanelShell>
  );
}
