// Single source of page geometry for screen and PDF.
// Numbers measured from a WriterDuet Quick Export PDF (see docs/writerduet-reference/TOKENS.md).
// Horizontal unit: one character (Courier 12 pt, 10 per inch, 7.2 pt).
// Vertical unit: one line (6 per inch, 12 pt).

export type ElementType =
  | 'scene'
  | 'action'
  | 'character'
  | 'parenthetical'
  | 'dialogue'
  | 'transition'
  | 'shot'
  | 'text'
  | 'note'
  | 'outline'
  | 'newAct'
  | 'endAct'
  | 'lyrics'
  | 'image'
  | 'sequence';

export const ELEMENT_TYPES: ElementType[] = [
  'scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot', 'text',
  'note', 'outline', 'newAct', 'endAct', 'lyrics', 'image', 'sequence',
];

export type Align = 'left' | 'center' | 'right';

export interface ElementSpec {
  /** Left edge in characters from the left edge of the paper. */
  left: number;
  /** Max characters per line. */
  width: number;
  /** Blank lines before the element (0 at the top of a page). */
  spaceBefore: number;
  align: Align;
  uppercase: boolean;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** Characters the first line hangs to the left (parenthetical "("). */
  hang: number;
}

export interface PageGeometry {
  paper: 'letter' | 'a4';
  widthPt: number;
  heightPt: number;
  charPt: number;
  linePt: number;
  /** Top of the first body line box. */
  topPt: number;
  /** Baseline offset inside a 12 pt line box. */
  baselinePt: number;
  linesPerPage: number;
  /** Page number: left edge, in characters, and line index relative to the body (negative is the top margin). */
  pageNumberCol: number;
  pageNumberRow: number;
  pageNumberFirstPage: boolean;
  sceneNumberLeftCol: number;
  sceneNumberRightCol: number;
  dual: { leftCol: number; rightCol: number; width: number; parenIndent: number };
  elements: Record<ElementType, ElementSpec>;
}

const el = (left: number, width: number, spaceBefore: number, o: Partial<ElementSpec> = {}): ElementSpec => ({
  left, width, spaceBefore, align: 'left', uppercase: false, bold: false, italic: false, underline: false, hang: 0, ...o,
});

export const DEFAULT_ELEMENTS: Record<ElementType, ElementSpec> = {
  scene: el(15, 61, 2, { uppercase: true }),
  action: el(15, 61, 1),
  character: el(35, 38, 1, { uppercase: true }),
  parenthetical: el(30, 25, 0, { hang: 1 }),
  dialogue: el(25, 35, 0),
  transition: el(15, 60, 1, { align: 'right', uppercase: true }),
  shot: el(15, 61, 2, { uppercase: true }),
  text: el(15, 61, 0),
  note: el(15, 61, 1),
  outline: el(15, 61, 1, { bold: true }),
  newAct: el(15, 60, 2, { align: 'center', uppercase: true, underline: true }),
  endAct: el(15, 60, 2, { align: 'center', uppercase: true, underline: true }),
  lyrics: el(25, 35, 0, { italic: true }),
  image: el(15, 61, 1),
  sequence: el(15, 61, 1, { bold: true }),
};

export const LETTER: PageGeometry = {
  paper: 'letter',
  widthPt: 612,
  heightPt: 792,
  charPt: 7.2,
  linePt: 12,
  topPt: 72,
  baselinePt: 8.25,
  linesPerPage: 54,
  pageNumberCol: 75,
  pageNumberRow: -3,
  pageNumberFirstPage: false,
  sceneNumberLeftCol: 7.5,
  sceneNumberRightCol: 74,
  dual: { leftCol: 15, rightCol: 47, width: 28, parenIndent: 2 },
  elements: DEFAULT_ELEMENTS,
};

export const A4: PageGeometry = {
  ...LETTER,
  paper: 'a4',
  widthPt: 595.28,
  heightPt: 841.89,
  // 841.89 pt tall with 1 in top and bottom margins leaves 58 lines.
  linesPerPage: 58,
};

/** Screen scale: 96 CSS px per inch. */
export const PX_PER_PT = 96 / 72;
export const CHAR_PX = 9.6;
export const LINE_PX = 16;

export function cloneGeometry(g: PageGeometry): PageGeometry {
  const elements = {} as Record<ElementType, ElementSpec>;
  for (const k of ELEMENT_TYPES) elements[k] = { ...g.elements[k] };
  return { ...g, dual: { ...g.dual }, elements };
}

export const colToPt = (g: PageGeometry, col: number) => col * g.charPt;
export const rowToBaselinePt = (g: PageGeometry, row: number) => g.topPt + row * g.linePt + g.baselinePt;
