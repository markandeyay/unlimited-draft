import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { importBytes, importText } from '../../src/import/writerduet';

describe('WriterDuet imports', () => {
  it('reads the JSON export with formatting, alignment, title page and page starts', () => {
    const line = (type: string, text: string, extra: Record<string, unknown> = {}) => ({ type, wdId: 'x', uid: 'y', text, attributes: { textAttributes: {} }, ...extra });
    const json = JSON.stringify({
      lines: [
        line('Scene', 'INT. DINER - NIGHT', { pageNumber: 1, attributes: { textAttributes: { b: [{ start: 0, end: 18 }] } } }),
        line('Action', 'A waitress pours\ncoffee.'),
        line('Character', 'JUNE'),
        line('Parens', '(tired)'),
        line('Dialogue', 'More?', { attributes: { textAttributes: { i: [{ start: 0, end: 4 }], u: [{ start: 2, end: 99 }] } } }),
        line('Transition', 'CUT TO BLACK.'),
        line('Action', 'THE END', { alignment: 'center', pageNumber: 2 }),
      ],
      titlePage: { lines: [line('Text', ''), line('Title', 'Night Shift'), line('Text', 'written by', { alignment: 'center' }), line('Author', 'M. Y.'), line('Text', 'Draft 2', { alignment: 'right' })] },
    });
    const r = importText(json, 'Night Shift.json');
    expect(r.format).toBe('WriterDuet (JSON)');
    expect(r.title).toBe('Night Shift');
    expect(r.author).toBe('M. Y.');
    expect(r.lines.map((l) => l.type)).toEqual(['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'action']);
    expect(r.lines[0].marks).toEqual([{ from: 0, to: 18, kind: 'bold' }]);
    expect(r.lines[1].text).toBe('A waitress pours coffee.');
    expect(r.lines[4].marks).toEqual([{ from: 0, to: 4, kind: 'italic' }, { from: 2, to: 5, kind: 'underline' }]);
    expect(r.lines[6].align).toBe('center');
    expect(r.pageStarts).toEqual([0, 6]);
    expect(r.titlePage!.map((l) => [l.text, l.align])).toEqual([['', undefined], ['Night Shift', 'center'], ['written by', 'center'], ['M. Y.', 'center'], ['Draft 2', 'right']]);
  });

  it('reads a .wdz archive with a checkpoint, keeps bold, and warns about edits after the checkpoint', () => {
    const script = {
      script_info: { script_title: 'Archive', script_author: 'M. Y.' },
      b: { '-': { h: { a: { a: 'cp' }, b: { l: 'data/bbb2/type', v: '"Action"' } } } },
    };
    const checkpoint = {
      checkpoint: {
        formatting: { custom_line_types: { list: {} } },
        data: {
          bbb2: { type: 'Action', cache: { t: 'He waits.\nShe does not.' } },
          bbb1: { type: 'Slugline', cache: { t: '\u0001INT. ROOM - DAY\u0002' } },
          bbb3: { type: 'EditDialogName', cache: { t: 'ANN' } },
          bbb4: { type: 'EditDialogContent', cache: { t: 'Hi.' } },
        },
      },
    };
    const zip = zipSync({ 'script.json': strToU8(JSON.stringify(script)), abc123: strToU8(JSON.stringify(checkpoint)) });
    const r = importBytes(zip, 'Archive.wdz');
    expect(r.format).toBe('WriterDuet (.wdz)');
    expect(r.title).toBe('Archive');
    expect(r.lines.map((l) => [l.type, l.text])).toEqual([['scene', 'INT. ROOM - DAY'], ['action', 'He waits.'], ['text', 'She does not.'], ['character', 'ANN'], ['dialogue', 'Hi.']]);
    expect(r.lines[0].marks).toEqual([{ from: 0, to: 15, kind: 'bold' }]);
    expect(r.warning).toContain('1 recent edits');
  });
});
