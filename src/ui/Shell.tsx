import {
  ArrowLeft, ArrowRight, ChartColumn, FileDown, Files, FileText, Menu, MessageSquareText, Pencil, Search, Wrench, X, type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type RailTab, activeDoc, useApp } from '../app/store';
import { Editor } from '../editor/Editor';
import { ELEMENT_LABELS } from '../editor/flow';
import type { ElementType } from '../layout/geometry';
import { useSettings } from '../settings/settings';
import { actions } from './actions';
import { MenuBar, MenuList, useMenus } from './MenuBar';
import { AccountPanel, AnalysisPanel, Cards, CardsPanel, CommentsPanel, ProjectPanel, ToolsPanel, useCommentHighlights } from './Panels';
import { Toolbar } from './Toolbar';
import css from './shell.module.css';

/** Nine filled squares. Drawn here because Lucide has no solid 3 by 3 grid. */
const CardsIcon = (({ size = 24 }: { size?: number | string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    {[2, 9, 16].flatMap((y) => [2, 9, 16].map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="6" height="6" rx="0.8" />))}
  </svg>
)) as unknown as LucideIcon;

const RAIL: { id: RailTab; label: string; icon: LucideIcon; tip: string }[] = [
  { id: 'project', label: 'Project', icon: Files, tip: 'Project Documents' },
  { id: 'cards', label: 'Cards', icon: CardsIcon, tip: 'Cards & Private Pad' },
  { id: 'comments', label: 'Comments', icon: MessageSquareText, tip: 'Comments' },
  { id: 'analysis', label: 'Analysis', icon: ChartColumn, tip: 'Analysis' },
  { id: 'tools', label: 'Tools', icon: Wrench, tip: 'Tools & Revisions' },
];

export function useIsPhone() {
  const [phone, setPhone] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const on = () => setPhone(window.innerWidth < 768);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return phone;
}

function Rail() {
  const rail = useApp((s) => s.rail);
  const panelOpen = useApp((s) => s.panelOpen);
  const auth = useApp((s) => s.auth);
  const sync = useApp((s) => s.sync.state);
  const set = useApp((s) => s.set);
  const pick = (id: RailTab) => set(rail === id ? { panelOpen: !panelOpen } : { rail: id, panelOpen: true });
  const dot = sync === 'synced' ? 'var(--ok)' : sync === 'pushing' ? 'var(--accent)' : sync === 'error' ? 'var(--danger)' : 'var(--warn)';
  return (
    <div className={css.rail} data-testid="rail">
      <button className={css.railBack} title="Hide sidebar" onClick={() => set({ sidebarHidden: true })} data-testid="rail-collapse">
        <ArrowLeft size={16} strokeWidth={2.6} />
      </button>
      {RAIL.map((r) => (
        <button key={r.id} className={`${css.railBtn} ${css.tip} ${rail === r.id ? css.railBtnActive : ''}`} data-tip={r.tip} onClick={() => pick(r.id)} data-testid={`rail-${r.id}`}>
          <r.icon size={24} strokeWidth={1.7} />
          {r.label}
          {r.id === 'project' && <span className={css.syncDot} style={{ background: dot }} />}
        </button>
      ))}
      <div className={css.railSpacer} />
      <button className={`${css.railBtn} ${rail === 'account' ? css.railBtnActive : ''}`} title="Account" onClick={() => pick('account')} data-testid="rail-account">
        <span className={css.avatar}>{auth.avatar ? <img src={auth.avatar} alt="" /> : 'MY'}</span>
        Account
      </button>
    </div>
  );
}

function Panel({ comments }: { comments: ReturnType<typeof useCommentHighlights> }) {
  const rail = useApp((s) => s.rail);
  const [width, setWidth] = useState(() => Number(localStorage.getItem('ud.panelWidth')) || 105);
  const drag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX, start = width;
    const move = (ev: MouseEvent) => setWidth(Math.max(105, Math.min(360, start + ev.clientX - startX)));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setWidth((w) => { localStorage.setItem('ud.panelWidth', String(w)); return w; });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  return (
    <div className={css.panel} style={{ width }} data-testid="panel">
      {rail === 'project' && <ProjectPanel />}
      {rail === 'cards' && <CardsPanel />}
      {rail === 'comments' && <CommentsPanel comments={comments.comments} reload={comments.reload} />}
      {rail === 'analysis' && <AnalysisPanel />}
      {rail === 'tools' && <ToolsPanel />}
      {rail === 'account' && <AccountPanel />}
      <div className={css.panelResize} onMouseDown={drag} title="Drag to resize" />
    </div>
  );
}

function useGlobalShortcuts() {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      const hit = (fn: () => void) => { e.preventDefault(); fn(); };
      if (k === 's' && e.shiftKey) hit(actions.externalBackups);
      else if (k === 's') hit(actions.saveProject);
      else if (k === 'o') hit(actions.openLibrary);
      else if (k === 'p') hit(actions.print);
      else if (k === 'f' && e.shiftKey) hit(actions.fullScreen);
      else if (k === 'f') hit(actions.find);
      else if (k === 'g') hit(actions.goTo);
    };
    const fs = () => useApp.setState({ fullscreen: !!document.fullscreenElement });
    window.addEventListener('keydown', on);
    document.addEventListener('fullscreenchange', fs);
    return () => { window.removeEventListener('keydown', on); document.removeEventListener('fullscreenchange', fs); };
  }, []);
}

function FilterBar() {
  const filter = useApp((s) => s.filter);
  if (!filter || filter.label === 'Outline hidden') return null;
  return (
    <div className={css.filterBar} data-testid="filter-bar">
      <span>Showing: {filter.label}</span>
      <button onClick={actions.clearFilter}>Show everything</button>
    </div>
  );
}

export function Shell() {
  const phone = useIsPhone();
  const doc = useApp((s) => activeDoc(s));
  const sidebarHidden = useApp((s) => s.sidebarHidden);
  const panelOpen = useApp((s) => s.panelOpen);
  const viewMode = useApp((s) => s.viewMode);
  const cursor = useApp((s) => s.cursor);
  const fullscreen = useApp((s) => s.fullscreen);
  const set = useApp((s) => s.set);
  const display = useSettings((s) => s.settings.display);
  const comments = useCommentHighlights();
  useGlobalShortcuts();

  if (phone) return <PhoneShell />;
  const zoom = display.zoom * display.textSize;
  const isTitle = doc?.kind === 'titlePage';
  const chrome = !fullscreen;

  return (
    <div className={css.shell}>
      {!sidebarHidden && chrome && <Rail />}
      {!sidebarHidden && chrome && panelOpen && <Panel comments={comments} />}
      <div className={css.workspace}>
        {sidebarHidden && chrome && (
          <button className={css.expand} title="Show sidebar" onClick={() => set({ sidebarHidden: false })} data-testid="rail-expand">
            <ArrowRight size={16} strokeWidth={2.6} />
          </button>
        )}
        <div className={css.head}>
          {chrome && <MenuBar />}
          {viewMode === 'page' && <Toolbar titlePage={isTitle} />}
          {viewMode === 'page' && doc?.kind === 'script' && (
            <div className={css.pillWrap}>
              <button className={css.pill} onClick={actions.titlePage} data-testid="to-title-page">Navigate to title page</button>
            </div>
          )}
        </div>
        <FilterBar />
        <div className={css.scroller} data-testid="scroller">
          {viewMode === 'cards' ? <Cards wide /> : doc && (
            <div className={`${css.pageHolder} ${display.pageShadow ? css.pageShadow : ''}`} style={{ zoom }}>
              <Editor key={doc.id} document={doc} />
            </div>
          )}
        </div>
        {isTitle && viewMode === 'page' && (
          <div className={css.titleBar}>
            You're editing the title page.
            <button className={css.pill} onClick={actions.backToScript} data-testid="to-script">Navigate to the script</button>
          </div>
        )}
        {display.showPageCount && viewMode === 'page' && doc && !isTitle && (
          <div style={{ width: 816, maxWidth: '100%', alignSelf: 'center', position: 'relative', height: 0 }}>
            <div className={css.pageCount} data-testid="page-count">{cursor.page} of {cursor.total}</div>
          </div>
        )}
      </div>
    </div>
  );
}

const PHONE_TYPES: ElementType[] = ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot', 'text', 'note'];

function PhoneShell() {
  const doc = useApp((s) => activeDoc(s));
  const docs = useApp((s) => s.docs);
  const project = useApp((s) => s.project);
  const type = useApp((s) => s.cursor.type);
  const [editing, setEditing] = useState(false);
  const [sheet, setSheet] = useState<'menu' | 'docs' | null>(null);
  const [width, setWidth] = useState(window.innerWidth);
  const menus = useMenus();
  const busy = useRef(false);
  useCommentHighlights();
  useEffect(() => {
    const on = () => setWidth(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const zoom = Math.min(1, width / 816);

  const exportPdf = async () => {
    if (busy.current) return;
    busy.current = true;
    try { await actions.quickExport(); } finally { busy.current = false; }
  };

  return (
    <div className={css.shell} style={{ flexDirection: 'column' }} data-testid="phone-shell">
      <div className={css.phoneTop}>
        <button onClick={actions.openLibrary} title="Library"><ArrowLeft size={20} /></button>
        <span>{project?.name}</span>
        <button onClick={() => setSheet('menu')} title="Menu" data-testid="phone-menu"><Menu size={22} /></button>
      </div>
      {editing && (
        <div className={css.phonePicker} data-testid="phone-picker">
          {PHONE_TYPES.map((t) => (
            <button key={t} className={type === t ? css.toolBtnActive : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => actions.setType(t)}>{ELEMENT_LABELS[t]}</button>
          ))}
        </div>
      )}
      <div className={css.scroller} style={{ justifyContent: 'flex-start' }}>
        {doc && (
          <div className={css.pageHolder} style={{ zoom }}>
            <Editor key={`${doc.id}-${editing ? 'e' : 'r'}`} document={doc} readOnly={!editing} />
          </div>
        )}
      </div>
      <div className={css.phoneBar}>
        <button className={css.phonePrimary} onClick={exportPdf} data-testid="phone-export"><FileDown size={20} /> Export PDF</button>
        <button onClick={() => setEditing(!editing)} data-testid="phone-edit">{editing ? <X size={18} /> : <Pencil size={18} />}{editing ? 'Done' : 'Edit'}</button>
        <button onClick={() => setSheet('docs')} data-testid="phone-docs"><FileText size={18} />Documents</button>
        <button onClick={actions.find} data-testid="phone-search"><Search size={18} />Search</button>
      </div>
      {sheet && <div className={css.sheetBackdrop} onClick={() => setSheet(null)} />}
      {sheet === 'docs' && (
        <div className={css.sheet}>
          <div className={css.sheetGroup}>Project Documents</div>
          <MenuList
            className=""
            onClose={() => setSheet(null)}
            items={docs.map((d) => ({ label: d.name, checked: d.id === doc?.id, action: () => actions.switchDocument(d.id) }))}
          />
        </div>
      )}
      {sheet === 'menu' && (
        <div className={css.sheet} data-testid="phone-sheet">
          {menus.map((m) => (
            <div key={m.label}>
              <div className={css.sheetGroup}>{m.label}</div>
              <MenuList className="" onClose={() => setSheet(null)} items={m.items.filter((i) => i !== 'sep' && !i.sub)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
