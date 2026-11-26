// All editor keyboard shortcuts live here.
// "Mod" is Ctrl on Windows/Linux and Cmd on Mac. Shortcuts copied from WriterDuet's menus.
import { baseKeymap, chainCommands, selectAll } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { Command } from 'prosemirror-state';
import type { ElementType } from '../layout/geometry';
import type { FlowRow } from '../storage/models';
import {
  backspaceEmpty, dualDialogue, enterCommand, exitDual, moveSelection, setLineType, shiftTabCommand, tabCommand,
  toggleBold, toggleItalic, togglePageBreak, toggleUnderline,
} from './commands';

/** Format > Line Type shortcuts: Ctrl+1 to Ctrl+0. */
export const ELEMENT_SHORTCUTS: Partial<Record<ElementType, string>> = {
  scene: 'Mod-1',
  action: 'Mod-2',
  character: 'Mod-3',
  parenthetical: 'Mod-4',
  dialogue: 'Mod-5',
  transition: 'Mod-6',
  shot: 'Mod-7',
  text: 'Mod-8',
  note: 'Mod-9',
  outline: 'Mod-0',
};

/** App-level shortcuts handled outside ProseMirror (see ui/shortcuts). Listed here so everything is in one file. */
export const APP_SHORTCUTS = {
  openProject: 'Ctrl+O',
  saveProject: 'Ctrl+S',
  externalBackups: 'Ctrl+Shift+S',
  print: 'Ctrl+P',
  find: 'Ctrl+F',
  goTo: 'Ctrl+G',
  fullScreen: 'Ctrl+Shift+F',
} as const;

export const SHORTCUT_LABELS = {
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Y',
  moveUp: 'Alt+Up',
  moveDown: 'Alt+Down',
  dual: 'Ctrl+D',
  exitDual: 'Ctrl+E',
  bold: 'Ctrl+B',
  italic: 'Ctrl+I',
  underline: 'Ctrl+U',
  selectAll: 'Ctrl+A',
  pageBreak: 'Ctrl+Enter',
  ...APP_SHORTCUTS,
} as const;

export function shortcutLabel(type: ElementType): string | undefined {
  return ELEMENT_SHORTCUTS[type]?.replace('Mod-', 'Ctrl+');
}

export function buildKeymaps(getFlow: () => Record<string, FlowRow>) {
  const enter = enterCommand(getFlow);
  const keys: Record<string, Command> = {
    Enter: enter,
    Tab: tabCommand(getFlow),
    'Shift-Tab': shiftTabCommand,
    'Mod-Enter': togglePageBreak,
    'Mod-z': undo,
    'Mod-y': redo,
    'Mod-Shift-z': redo,
    'Alt-ArrowUp': moveSelection(-1),
    'Alt-ArrowDown': moveSelection(1),
    'Mod-d': dualDialogue,
    'Mod-e': exitDual,
    'Mod-b': toggleBold,
    'Mod-i': toggleItalic,
    'Mod-u': toggleUnderline,
    'Mod-a': selectAll,
    Backspace: chainCommands(backspaceEmpty, baseKeymap.Backspace),
  };
  for (const [type, key] of Object.entries(ELEMENT_SHORTCUTS)) keys[key] = setLineType(type as ElementType);
  return { enter, plugins: [keymap(keys), keymap(baseKeymap)] };
}
