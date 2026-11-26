import { Check, ChevronRight, ChevronUp, CircleHelp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app/store';
import { ELEMENT_LABELS, TOOLBAR_ORDER } from '../editor/flow';
import { SHORTCUT_LABELS, shortcutLabel } from '../editor/keymap';
import { useSettings } from '../settings/settings';
import * as store from '../storage/db';
import type { ProjectFile } from '../storage/models';
import { actions } from './actions';
import css from './shell.module.css';

export type MenuItem =
  | 'sep'
  | { label: string; shortcut?: string; action?: () => void; checked?: boolean; disabled?: boolean; sub?: MenuItem[]; swatch?: string; testId?: string };

const COLORS: [string, string][] = [
  ['Black', '#000000'], ['Red', '#d32f2f'], ['Orange', '#ef6c00'], ['Green', '#2e7d32'], ['Blue', '#1565c0'], ['Purple', '#6a1b9a'], ['Grey', '#757575'],
];
const HIGHLIGHTS: [string, string][] = [
  ['Yellow', '#fff59d'], ['Green', '#c5e1a5'], ['Blue', '#b3e5fc'], ['Pink', '#f8bbd0'], ['Orange', '#ffcc80'], ['Purple', '#d1c4e9'],
];

export function MenuList({ items, onClose, className }: { items: MenuItem[]; onClose: () => void; className?: string }) {
  const [sub, setSub] = useState<number | null>(null);
  const hasChecks = items.some((i) => i !== 'sep' && i.checked !== undefined);
  return (
    <div className={`${css.menu} ${className ?? ''}`} role="menu">
      {items.map((it, i) => {
        if (it === 'sep') return <div key={i} className={css.menuSep} />;
        return (
          <div
            key={i}
            role="menuitem"
            data-testid={it.testId}
            className={`${css.menuItem} ${it.disabled ? css.menuDisabled : ''} ${sub === i ? css.menuItemOpen : ''}`}
            onMouseEnter={() => setSub(it.sub ? i : null)}
            onClick={(e) => {
              e.stopPropagation();
              if (it.disabled || it.sub) return;
              onClose();
              it.action?.();
            }}
          >
            {hasChecks && <span className={css.menuCheck}>{it.checked ? <Check size={13} strokeWidth={3} /> : null}</span>}
            {it.swatch && <span className={css.swatch} style={{ background: it.swatch }} />}
            <span className={css.menuLabel}>{it.label}</span>
            {it.shortcut && <span className={css.menuShortcut}>{it.shortcut}</span>}
            {it.sub && <ChevronRight size={12} className={css.menuArrow} fill="currentColor" />}
            {it.sub && sub === i && <MenuList items={it.sub} onClose={onClose} className={css.submenu} />}
          </div>
        );
      })}
    </div>
  );
}

export function useMenus(): { label: string; items: MenuItem[] }[] {
  const s = useSettings((x) => x.settings);
  const app = useApp();
  const [recents, setRecents] = useState<ProjectFile[]>([]);
  useEffect(() => {
    void store.listProjects().then((ps) => setRecents(ps.sort((a, b) => (b.openedAt ?? '').localeCompare(a.openedAt ?? '')).slice(0, 8)));
  }, [app.project?.id, app.libraryVersion]);
  const hasProject = !!app.project;
  const type = app.cursor.type;
  const sizes: [string, number][] = [['Small', 0.85], ['Normal', 1], ['Large', 1.15], ['Larger', 1.3]];
  const zooms = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2];

  return [
    {
      label: 'File',
      items: [
        { label: 'New Project', action: actions.newProject, testId: 'menu-new-project' },
        { label: 'Open Project', shortcut: SHORTCUT_LABELS.openProject, action: actions.openLibrary },
        { label: 'Open Recent...', sub: recents.length ? recents.map((p) => ({ label: p.name, action: () => actions.openRecent(p.id) })) : [{ label: 'No recent projects', disabled: true }] },
        'sep',
        { label: 'Save Project', shortcut: SHORTCUT_LABELS.saveProject, action: actions.saveProject, disabled: !hasProject },
        { label: 'Set External Backups...', shortcut: SHORTCUT_LABELS.externalBackups, action: actions.externalBackups },
        { label: 'Rename Project...', action: actions.renameProject, disabled: !hasProject },
        { label: 'Duplicate Project...', action: actions.duplicateProject, disabled: !hasProject },
        { label: 'Remove Project...', action: actions.removeProject, disabled: !hasProject },
        'sep',
        { label: 'Import...', action: actions.importFile },
        { label: 'Export...', action: actions.exportDialog, disabled: !hasProject, testId: 'menu-export' },
        { label: 'Quick Export (PDF)', action: actions.quickExport, disabled: !hasProject },
        { label: 'Preview', action: actions.preview, disabled: !hasProject },
        { label: 'Print', shortcut: SHORTCUT_LABELS.print, action: actions.print, disabled: !hasProject },
        'sep',
        { label: 'Close Tab', action: actions.closeTab },
        { label: 'Close All Tabs Except Current', action: actions.closeOtherTabs },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: SHORTCUT_LABELS.undo, action: actions.undo },
        { label: 'Redo', shortcut: SHORTCUT_LABELS.redo, action: actions.redo },
        { label: 'Move Selection Up', shortcut: SHORTCUT_LABELS.moveUp, action: actions.moveUp },
        { label: 'Move Selection Down', shortcut: SHORTCUT_LABELS.moveDown, action: actions.moveDown },
        'sep',
        {
          label: 'Insert', sub: [
            { label: 'Page Break', shortcut: SHORTCUT_LABELS.pageBreak, action: actions.insertPageBreak },
            { label: 'Scene', action: actions.insertScene },
            { label: 'Image', action: actions.insertImage },
            { label: 'Act Break', action: actions.insertActBreak },
            { label: 'Sequence', action: actions.insertSequence },
          ],
        },
        'sep',
        { label: 'Select All', shortcut: SHORTCUT_LABELS.selectAll, action: actions.selectAll },
        'sep',
        { label: 'Find...', shortcut: SHORTCUT_LABELS.find, action: actions.find, testId: 'menu-find' },
        { label: 'Filter...', action: actions.filter },
        { label: 'Go To...', shortcut: SHORTCUT_LABELS.goTo, action: actions.goTo },
      ],
    },
    {
      label: 'Format',
      items: [
        { label: 'Line Type', sub: TOOLBAR_ORDER.map((t) => ({ label: ELEMENT_LABELS[t], shortcut: shortcutLabel(t), checked: type === t, action: () => actions.setType(t) })) },
        { label: 'Dual Dialogue', shortcut: SHORTCUT_LABELS.dual, action: actions.dual },
        { label: 'Exit Dual', shortcut: SHORTCUT_LABELS.exitDual, action: actions.exitDual, disabled: !app.cursor.dual },
        'sep',
        { label: 'Document Template', sub: [{ label: 'Screenplay', checked: true }] },
        'sep',
        { label: 'Margins', sub: [{ label: 'Page Margins...', action: () => actions.customize('Page') }, { label: 'Line Type Margins...', action: () => actions.customize('Format') }] },
        'sep',
        { label: 'Font Settings', action: () => actions.customize('Format') },
        {
          label: 'Text Style', sub: [
            { label: 'Bold', shortcut: SHORTCUT_LABELS.bold, checked: app.cursor.bold, action: actions.bold },
            { label: 'Italic', shortcut: SHORTCUT_LABELS.italic, checked: app.cursor.italic, action: actions.italic },
            { label: 'Underline', shortcut: SHORTCUT_LABELS.underline, checked: app.cursor.underline, action: actions.underline },
            { label: 'Strikethrough', checked: app.cursor.strike, action: actions.strike },
          ],
        },
        { label: 'Text Color', sub: [...COLORS.map(([l, v]) => ({ label: l, swatch: v, action: () => actions.color(v === '#000000' ? null : v) }))] },
        { label: 'Text Highlight', sub: [{ label: 'None', action: () => actions.highlight(null) }, ...HIGHLIGHTS.map(([l, v]) => ({ label: l, swatch: v, action: () => actions.highlight(v) }))] },
        { label: 'Text Alignment', sub: [{ label: 'Left', action: () => actions.align('left') }, { label: 'Center', action: () => actions.align('center') }, { label: 'Right', action: () => actions.align('right') }] },
        { label: 'Bullets', sub: [{ label: 'Toggle Bullet', action: actions.bullets }] },
      ],
    },
    { label: 'Share', items: [{ label: 'Email Document', action: actions.emailDocument, disabled: !hasProject }] },
    {
      label: 'View',
      items: [
        { label: 'Page View', checked: app.viewMode === 'page', action: actions.pageView },
        { label: 'Card View', checked: app.viewMode === 'cards', action: actions.cardView },
        'sep',
        { label: 'Full Screen', shortcut: SHORTCUT_LABELS.fullScreen, checked: app.fullscreen, action: actions.fullScreen },
        { label: 'Dark Mode', checked: s.display.darkMode, action: actions.toggleDark, testId: 'menu-dark' },
        'sep',
        { label: 'Page Breaks', checked: s.display.showPageBreaks, action: actions.togglePageBreaks },
        { label: 'Page Count', checked: s.display.showPageCount, action: actions.togglePageCount },
        { label: 'Show Outline', checked: app.filter?.label !== 'Outline hidden', action: actions.toggleOutline },
        'sep',
        { label: 'Text Size', sub: sizes.map(([l, v]) => ({ label: l, checked: s.display.textSize === v, action: () => actions.textSize(v) })) },
        { label: 'Page Zoom', sub: zooms.map((z) => ({ label: `${Math.round(z * 100)}%`, checked: s.display.zoom === z, action: () => actions.zoom(z) })) },
        { label: 'Customize Layout', action: () => actions.customize('Display') },
      ],
    },
    {
      label: 'Tools',
      items: [
        { label: 'Comments', action: actions.comments },
        { label: 'Spelling & Grammar', action: actions.spelling },
        'sep',
        { label: 'Rename Character...', action: actions.renameCharacter },
        'sep',
        { label: 'Word Count', action: actions.wordCount },
      ],
    },
    {
      label: 'Reports',
      items: [
        { label: 'Document Statistics...', action: () => actions.report('stats') },
        'sep',
        { label: 'PDF w/notes...', action: actions.pdfWithNotes },
        { label: 'Dialogue Filter...', action: () => actions.report('dialogue') },
        { label: 'Non-Dialogue Filter', action: () => actions.report('nonDialogue') },
        { label: 'List of Shots', action: () => actions.report('shots') },
        { label: 'Hide All Shots', checked: app.hideShots, action: actions.toggleHideShots },
        { label: 'Hide Inline Notes', checked: app.hideNotes, action: actions.toggleHideNotes },
        { label: 'Locations & Scenes...', action: () => actions.report('locations') },
        { label: 'Character Scenes Filter...', action: () => actions.report('characterScenes') },
      ],
    },
    {
      label: 'Revisions',
      items: [
        { label: "Current Line's History", action: actions.lineHistory },
        'sep',
        { label: 'View & Track...', action: actions.viewTrack },
        { label: 'Accept/Reject...', action: actions.acceptReject },
        { label: 'Date & Writers...', action: actions.dateWriters },
        'sep',
        { label: 'Mark Change', action: actions.markChange },
        { label: 'Unmark Change', action: actions.unmarkChange },
        'sep',
        { label: 'Timeline View', action: actions.timeline },
        { label: 'Save Snapshot', action: actions.saveSnapshot },
        { label: 'Document Snapshots', action: actions.snapshots },
      ],
    },
    {
      label: 'Production',
      items: [
        { label: 'Scene Numbers...', action: actions.sceneNumbers },
        { label: 'Headers & Footers...', action: actions.headersFooters },
        { label: 'Mores & Continueds...', action: actions.mores },
        'sep',
        { label: 'Separate Scene', action: actions.separateScene },
        { label: 'Omit Scene', action: actions.omitScene },
      ],
    },
    {
      label: 'Customize',
      items: ['Editing', 'Display', 'Format', 'PDF', 'Page', 'Misc'].map((t) => ({ label: `${t}...`, action: () => actions.customize(t) })),
    },
    {
      label: 'Help',
      items: [
        { label: 'Keyboard Shortcuts', action: actions.shortcuts },
        { label: 'About Unlimited Draft', action: actions.about },
      ],
    },
  ];
}

export function MenuBar() {
  const menus = useMenus();
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menubarOpen = useApp((s) => s.menubarOpen);
  const set = useApp((s) => s.set);

  useEffect(() => {
    if (open === null) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);

  return (
    <div className={css.menubar} ref={ref} data-testid="menubar">
      <button className={css.caret} title={menubarOpen ? 'Hide menu' : 'Show menu'} onClick={() => set({ menubarOpen: !menubarOpen })}>
        <ChevronUp size={18} strokeWidth={3} style={{ transform: menubarOpen ? undefined : 'rotate(180deg)' }} />
      </button>
      {menubarOpen && menus.map((m, i) => (
        <div
          key={m.label}
          className={`${css.menuTitle} ${open === i ? css.menuTitleOpen : ''}`}
          onMouseDown={(e) => { e.preventDefault(); setOpen(open === i ? null : i); }}
          onMouseEnter={() => { if (open !== null) setOpen(i); }}
        >
          {m.label}
          {open === i && <MenuList items={m.items} onClose={() => setOpen(null)} className={css.dropdown} />}
        </div>
      ))}
      {menubarOpen && (
        <button className={css.helpBtn} title="Keyboard shortcuts" onClick={actions.shortcuts}>
          <CircleHelp size={19} fill="#fff" color="#17232e" />
        </button>
      )}
    </div>
  );
}
