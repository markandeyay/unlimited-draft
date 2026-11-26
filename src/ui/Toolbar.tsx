import {
  ArrowLeftRight, Image as ImageIcon, ListTree, Megaphone, Menu, MessageCircle, MessagesSquare, Music,
  Parentheses, Quote, TextQuote, Triangle, User, Video, type LucideIcon,
} from 'lucide-react';
import { useApp } from '../app/store';
import { ELEMENT_LABELS, TOOLBAR_ORDER } from '../editor/flow';
import type { ElementType } from '../layout/geometry';
import { actions } from './actions';
import css from './shell.module.css';

/** Bold letter glyphs for Text ("A") and Note ("!"), drawn as text so they read like solid icons. */
const glyph = (ch: string) => (({ size = 17 }: { size?: number | string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <text x="12" y="20" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontWeight="700" fontSize="23" fill="currentColor">{ch}</text>
  </svg>
)) as unknown as LucideIcon;
const TextGlyph = glyph('A');
const NoteGlyph = glyph('!');

// Lucide icons chosen to look close to WriterDuet's toolbar glyphs.
export const ELEMENT_ICONS: Record<ElementType, LucideIcon> = {
  scene: ImageIcon,
  action: Megaphone,
  character: User,
  parenthetical: Parentheses,
  dialogue: MessageCircle,
  transition: ArrowLeftRight,
  shot: Video,
  text: TextGlyph,
  note: NoteGlyph,
  outline: ListTree,
  newAct: Quote,
  endAct: TextQuote,
  lyrics: Music,
  image: ImageIcon,
  sequence: Menu,
};

const FILLED = new Set<ElementType>(['scene', 'action', 'character', 'dialogue', 'shot', 'newAct', 'lyrics', 'image']);
const TITLE_TYPES: ElementType[] = ['text', 'note', 'image', 'outline'];

export function Toolbar({ titlePage = false }: { titlePage?: boolean }) {
  const type = useApp((s) => s.cursor.type);
  const dual = useApp((s) => s.cursor.dual);
  const open = useApp((s) => s.toolbarOpen);
  const set = useApp((s) => s.set);
  const types = titlePage ? TITLE_TYPES : TOOLBAR_ORDER;

  if (!open) {
    return (
      <div className={`${css.toolbar} ${css.toolbarCollapsed}`} data-testid="toolbar">
        <button className={css.toolbarCaret} title="Show toolbar" onClick={() => set({ toolbarOpen: true })}>
          <Triangle size={8} fill="currentColor" style={{ transform: 'rotate(180deg)' }} />
        </button>
      </div>
    );
  }
  return (
    <div className={css.toolbar} data-testid="toolbar" style={titlePage ? { justifyContent: 'center' } : undefined}>
      <button className={css.toolbarCaret} title="Hide toolbar" onClick={() => set({ toolbarOpen: false })} style={titlePage ? { position: 'absolute', left: 150 } : undefined}>
        <Triangle size={11} fill="currentColor" strokeWidth={2} />
      </button>
      {types.map((t) => {
        const Icon = ELEMENT_ICONS[t];
        const active = type === t;
        return (
          <button
            key={t}
            className={`${css.toolBtn} ${active ? css.toolBtnActive : ''}`}
            data-testid={`el-${t}`}
            data-active={active || undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => actions.setType(t)}
            title={ELEMENT_LABELS[t]}
          >
            <Icon size={17} strokeWidth={2.2} fill={FILLED.has(t) ? 'currentColor' : 'none'} fillOpacity={t === 'scene' || t === 'image' ? 0.25 : 1} />
            {ELEMENT_LABELS[t]}
          </button>
        );
      })}
      {!titlePage && (
        <button
          className={`${css.toolBtn} ${dual ? css.toolBtnActive : ''}`}
          data-testid="el-dual"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (dual ? actions.exitDual() : actions.dual())}
          title="Dual dialogue"
        >
          <MessagesSquare size={17} strokeWidth={2.2} fill="currentColor" />
          Dual
        </button>
      )}
    </div>
  );
}
