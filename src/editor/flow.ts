// Enter and Tab element flow. One table, editable in Customize > Editing.
// Defaults follow SYSTEM_DESIGN.md Section 4.2 (WriterDuet "Enter/Tab traditional behavior").
import type { ElementType } from '../layout/geometry';
import type { FlowRow } from '../storage/models';

const row = (enter: ElementType, enterEmpty: ElementType, tab: ElementType): FlowRow => ({ enter, enterEmpty, tab });

export const DEFAULT_FLOW: Record<ElementType, FlowRow> = {
  scene: row('action', 'action', 'action'),
  action: row('action', 'character', 'character'),
  character: row('dialogue', 'action', 'transition'),
  parenthetical: row('dialogue', 'dialogue', 'dialogue'),
  dialogue: row('character', 'action', 'parenthetical'),
  transition: row('scene', 'scene', 'scene'),
  shot: row('action', 'action', 'action'),
  text: row('text', 'action', 'action'),
  note: row('note', 'action', 'action'),
  lyrics: row('lyrics', 'action', 'action'),
  outline: row('outline', 'action', 'action'),
  sequence: row('action', 'action', 'action'),
  newAct: row('scene', 'scene', 'scene'),
  endAct: row('newAct', 'action', 'action'),
  image: row('action', 'action', 'action'),
};

export const ELEMENT_LABELS: Record<ElementType, string> = {
  scene: 'Scene',
  action: 'Action',
  character: 'Character',
  parenthetical: 'Parens',
  dialogue: 'Dialogue',
  transition: 'Transition',
  shot: 'Shot',
  text: 'Text',
  note: 'Note',
  outline: 'Outline',
  newAct: 'New Act',
  endAct: 'End Act',
  lyrics: 'Lyrics',
  image: 'Image',
  sequence: 'Sequence',
};

/** Toolbar order, exactly WriterDuet's. "Dual" is appended by the toolbar itself. */
export const TOOLBAR_ORDER: ElementType[] = [
  'scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot', 'text',
  'note', 'outline', 'newAct', 'endAct', 'lyrics', 'image', 'sequence',
];

export const SCENE_INTROS = ['INT.', 'EXT.', 'INT./EXT.', 'I/E'];
export const SCENE_TIMES = ['DAY', 'NIGHT', 'MORNING', 'EVENING', 'CONTINUOUS', 'LATER', 'MOMENTS LATER'];
export const TRANSITIONS = ['CUT TO:', 'FADE IN:', 'FADE OUT.', 'DISSOLVE TO:', 'SMASH CUT TO:', 'MATCH CUT TO:'];
export const CHARACTER_EXTENSIONS = ['(V.O.)', '(O.S.)', '(O.C.)', "(CONT'D)"];

export const SCENE_START = /^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|INT\.|EXT\.|I\/E\.?)(\s|$)/i;
export const TRANSITION_END = /TO:$/;
