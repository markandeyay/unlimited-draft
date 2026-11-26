import { describe, expect, it } from 'vitest';
import { createLayoutEngine, type LayoutLine } from '../../src/layout/paginate';
import { wrapText } from '../../src/layout/wrap';

let n = 0;
const L = (type: LayoutLine['type'], text: string, extra: Partial<LayoutLine> = {}): LayoutLine => ({ id: `t${n++}`, type, text, ...extra });
const filler = (rows: number): LayoutLine[] => Array.from({ length: rows }, () => L('text', 'x'));
const lay = (lines: LayoutLine[], o = {}) => createLayoutEngine().layout(lines, o);
const texts = (p: { rows: { text: string; row: number }[] }) => p.rows.map((r) => `${r.row}:${r.text}`);

describe('wrapText', () => {
  it('breaks on the last space and hangs trailing spaces', () => {
    const t = 'aaaa bbbb cccc';
    expect(wrapText(t, 9).map((s) => t.slice(s.start, s.end))).toEqual(['aaaa bbbb', 'cccc']);
    expect(wrapText(t, 8).map((s) => t.slice(s.start, s.end))).toEqual(['aaaa', 'bbbb', 'cccc']);
  });
  it('hard-breaks long words', () => {
    const t = 'abcdefghij';
    expect(wrapText(t, 4).map((s) => t.slice(s.start, s.end))).toEqual(['abcd', 'efgh', 'ij']);
  });
  it('fits exactly the max width', () => {
    const t = 'x'.repeat(61);
    expect(wrapText(t, 61).length).toBe(1);
    expect(wrapText(t + ' y', 61).length).toBe(2);
  });
  it('gives an empty line one row', () => {
    expect(wrapText('', 10)).toEqual([{ start: 0, end: 0 }]);
  });
});

describe('page breaking rules', () => {
  it('fits 54 lines per page', () => {
    const r = lay(filler(55));
    expect(r.pages.length).toBe(2);
    expect(r.pages[0].rows.length).toBe(54);
  });

  it('never leaves a scene heading at the bottom of a page', () => {
    const lines = [...filler(50), L('scene', 'INT. HOUSE - DAY'), L('action', 'One line. ' + 'word '.repeat(40))];
    const r = lay(lines);
    expect(r.pages[1].rows[0].text).toBe('INT. HOUSE - DAY');
    expect(r.pages[1].rows[0].row).toBe(0);
  });

  it('keeps a character name with its dialogue', () => {
    const lines = [...filler(52), L('character', 'BOB'), L('dialogue', 'Hello there.')];
    const r = lay(lines);
    expect(texts(r.pages[1])).toEqual(['0:BOB', '1:Hello there.']);
  });

  it('splits long dialogue at a sentence with MORE and CONTD in the margins', () => {
    const sentence = 'This is a sentence that runs on. ';
    const lines = [...filler(46), L('character', 'ANNA'), L('dialogue', sentence.repeat(12).trim())];
    const r = lay(lines);
    const p0 = r.pages[0].rows;
    const more = p0[p0.length - 1];
    expect(more.kind).toBe('more');
    expect(more.text).toBe('(MORE)');
    expect(p0[p0.length - 2].text).toMatch(/[.]$/);
    expect(r.pages[1].rows[0].kind).toBe('contd');
    expect(r.pages[1].rows[0].row).toBe(-1);
    expect(r.pages[1].rows[0].text).toBe("ANNA\u00a0(CONT'D)");
    expect(r.pages[1].rows[1].row).toBe(0);
  });

  it('moves dialogue whole when there is no sentence break', () => {
    const lines = [...filler(48), L('character', 'ANNA'), L('dialogue', 'word '.repeat(60).trim() + '.')];
    const r = lay(lines);
    expect(r.pages[1].rows[0].text).toBe('ANNA');
  });

  it('splits action between sentences with two lines on each side', () => {
    const lines = [...filler(49), L('action', 'Short sentence here. '.repeat(18).trim())];
    const r = lay(lines);
    const last = r.pages[0].rows[r.pages[0].rows.length - 1];
    expect(last.type).toBe('action');
    expect(last.text).toMatch(/\.$/);
    expect(r.pages[1].rows.length).toBeGreaterThanOrEqual(2);
  });

  it('does not let a transition start a page alone', () => {
    const lines = [...filler(51), L('action', 'He leaves.'), L('transition', 'CUT TO:')];
    const r = lay(lines);
    expect(texts(r.pages[1])).toEqual(['0:He leaves.', '2:CUT TO:']);
  });

  it('adds automatic CONTD for the same speaker in a scene', () => {
    const lines = [
      L('scene', 'INT. A - DAY'), L('character', 'BOB'), L('dialogue', 'One.'), L('action', 'He waits.'),
      L('character', 'BOB'), L('dialogue', 'Two.'), L('character', 'AMY'), L('dialogue', 'Hi.'),
      L('character', 'BOB'), L('dialogue', 'Three.'), L('scene', 'INT. B - DAY'), L('character', 'BOB'), L('dialogue', 'Four.'),
    ];
    const r = lay(lines);
    const names = r.pages[0].rows.filter((x) => x.type === 'character').map((x) => x.text);
    expect(names).toEqual(['BOB', "BOB\u00a0(CONT'D)", 'AMY', 'BOB', 'BOB']);
    expect(lay(lines, { autoContd: false }).pages[0].rows.filter((x) => x.text.includes('CONT')).length).toBe(0);
  });

  it('lays dual dialogue side by side and never splits it', () => {
    const lines = [
      ...filler(50),
      L('character', 'A', { dual: 'left' }), L('dialogue', 'left words '.repeat(10).trim(), { dual: 'left' }),
      L('character', 'B', { dual: 'right' }), L('dialogue', 'right.', { dual: 'right' }),
      L('action', 'After.'),
    ];
    const r = lay(lines);
    const p = r.pages[1].rows;
    const a = p.find((x) => x.text === 'A')!;
    const b = p.find((x) => x.text === 'B')!;
    expect(a.row).toBe(0);
    expect(b.row).toBe(0);
    expect(b.col).toBeGreaterThan(a.col + 20);
    const after = p.find((x) => x.text === 'After.')!;
    expect(after.row).toBe(Math.max(...p.filter((x) => x.type === 'dialogue').map((x) => x.row)) + 2);
  });

  it('honors manual page breaks and starts acts on a new page', () => {
    const r = lay([L('action', 'One.'), L('action', 'Two.', { pageBreakBefore: true }), L('newAct', 'Act Two'), L('action', 'Three.')]);
    expect(r.pages.length).toBe(3);
    expect(r.pages[2].rows[0].text).toBe('ACT TWO');
    expect(r.pages[2].rows[0].underline).toBe(true);
  });

  it('puts two blank lines before a scene and none at the top of a page', () => {
    const r = lay([L('scene', 'INT. A - DAY'), L('action', 'One.'), L('scene', 'INT. B - DAY')]);
    expect(r.pages[0].rows.map((x) => x.row)).toEqual([0, 2, 5]);
  });

  it('right-aligns transitions and hangs the parenthetical', () => {
    const r = lay([L('character', 'BOB'), L('parenthetical', '(quietly)'), L('dialogue', 'Hi.'), L('transition', 'cut to:')]);
    const rows = r.pages[0].rows;
    expect(rows[0].col).toBe(35);
    expect(rows[1].col).toBe(29);
    expect(rows[2].col).toBe(25);
    expect(rows[3].text).toBe('CUT TO:');
    expect(rows[3].col + rows[3].text.length).toBe(75);
  });

  it('hides chosen element types and omitted scenes', () => {
    const lines = [L('scene', 'INT. A - DAY', { omitted: true }), L('action', 'Gone.', { omitted: true }), L('note', 'Remember'), L('scene', 'INT. B - DAY'), L('action', 'Here.')];
    const r = lay(lines, { hide: new Set(['note'] as const) });
    expect(r.pages[0].rows.map((x) => x.text)).toEqual(['OMITTED', 'INT. B - DAY', 'Here.']);
  });

  it('adds scene continueds when enabled', () => {
    const lines = [L('scene', 'INT. A - DAY'), ...Array.from({ length: 40 }, () => L('action', 'A line.'))];
    const r = lay(lines, { sceneContinueds: true });
    expect(r.pages[0].rows.some((x) => x.kind === 'continuedBottom')).toBe(true);
    expect(r.pages[1].rows.some((x) => x.kind === 'continuedTop')).toBe(true);
  });

  it('reports wraps, breaks and splits per line for the editor', () => {
    const sentence = 'This is a sentence that runs on. ';
    const lines = [...filler(46), L('character', 'ANNA'), L('dialogue', sentence.repeat(12).trim())];
    const r = lay(lines);
    const d = r.info.get(lines[47].id)!;
    expect(d.wraps.length).toBeGreaterThan(5);
    expect(d.splits.length).toBe(1);
    expect(d.splits[0].more).toBe(true);
    expect(d.wraps).toContain(d.splits[0].offset);
  });
});

describe('performance', () => {
  it('re-lays out a 120 page script well under 16 ms after one edit', () => {
    const engine = createLayoutEngine();
    const lines: LayoutLine[] = [];
    for (let s = 0; s < 130; s++) {
      lines.push(L('scene', `INT. LOCATION ${s} - DAY`));
      for (let k = 0; k < 6; k++) {
        lines.push(L('action', 'Somebody walks into the room and looks around for a while. Then they sit down and wait for the other person.'));
        lines.push(L('character', k % 2 ? 'ALEX' : 'JORDAN'));
        lines.push(L('dialogue', 'I have been thinking about what you said. It does not add up, and I think you know that as well as I do.'));
      }
    }
    const first = engine.layout(lines);
    expect(first.pages.length).toBeGreaterThanOrEqual(120);
    let worst = 0;
    for (let i = 0; i < 30; i++) {
      const idx = 100 + i * 50;
      lines[idx] = { ...lines[idx], text: lines[idx].text + 'x' };
      const t0 = performance.now();
      engine.layout(lines);
      worst = Math.max(worst, performance.now() - t0);
    }
    expect(worst).toBeLessThan(16);
  });
});
