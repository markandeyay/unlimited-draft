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

/** What each line type is for, shown as a tooltip. */
export const ELEMENT_TIPS: Record<ElementType | 'dual', string> = {
  scene: 'Where and when the scene happens. Starts with INT. or EXT. and usually ends with DAY or NIGHT.',
  action: 'What we see and hear: the setting and what happens.',
  character: 'Who is speaking. Sits above the dialogue or a parenthetical.',
  parenthetical: 'How a line is said. Sits under the character name or inside dialogue.',
  dialogue: 'What the character says.',
  transition: 'How we move to the next scene, like CUT TO:. Use sparingly.',
  shot: 'A camera direction, like CLOSE ON. Use sparingly.',
  text: 'Anything that does not fit another line type.',
  note: 'A note to yourself. It is not printed in the PDF.',
  outline: 'An outline line. It is not printed in the PDF.',
  newAct: 'Starts a new act. For TV and stage scripts.',
  endAct: 'Ends an act. For TV and stage scripts.',
  lyrics: 'Dialogue that is sung.',
  image: 'Place a picture in the script.',
  sequence: 'A story beat that groups scenes.',
  dual: 'Two characters speaking at the same time.',
};

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
      {types.map((t, i) => {
        const Icon = ELEMENT_ICONS[t];
        const active = type === t;
        return (
          <button
            key={t}
            className={`${css.toolBtn} ${css.tip} ${i > 9 ? css.tipRight : ''} ${active ? css.toolBtnActive : ''}`}
            data-tip={ELEMENT_TIPS[t]}
            data-testid={`el-${t}`}
            data-active={active || undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => actions.setType(t)}
          >
            <Icon size={17} strokeWidth={2.2} fill={FILLED.has(t) ? 'currentColor' : 'none'} fillOpacity={t === 'scene' || t === 'image' ? 0.25 : 1} />
            {ELEMENT_LABELS[t]}
          </button>
        );
      })}
      {!titlePage && (
        <button
          className={`${css.toolBtn} ${css.tip} ${css.tipRight} ${dual ? css.toolBtnActive : ''}`}
          data-tip={ELEMENT_TIPS.dual}
          data-testid="el-dual"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (dual ? actions.exitDual() : actions.dual())}
        >
          <MessagesSquare size={17} strokeWidth={2.2} fill="currentColor" />
          Dual
        </button>
      )}
    </div>
  );
}
