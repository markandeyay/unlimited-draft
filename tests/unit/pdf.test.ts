import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import golden from '../layout/fixtures/wd-golden.json';
import { parseFdx } from '../../src/import/fdx';
import { parseFountain, toFountain } from '../../src/import/fountain';
import { importBytes, importText } from '../../src/import/writerduet';
import { LETTER } from '../../src/layout/geometry';
import { computeSceneNumbers } from '../../src/layout/sceneNumbers';
import { buildPdf, layoutForPrint, setFontLoader } from '../../src/pdf/export';
import { classifyPdf, extractPdfPages } from '../../src/pdf/import';
import { documentStats, splitScenes } from '../../src/reports/analyze';
import { defaultDocumentSettings, defaultSettings } from '../../src/settings/settings';
import { defaultTitlePageLines } from '../../src/storage/db';
import type { DocumentFile, Line } from '../../src/storage/models';
import { strToU8, zipSync } from 'fflate';

const font = (n: string) => new Uint8Array(readFileSync(`public/fonts/CourierPrime-${n}.ttf`));
setFontLoader(async () => ({ regular: font('Regular'), bold: font('Bold'), italic: font('Italic'), boldItalic: font('BoldItalic') }));

const at = '2026-01-01T00:00:00.000Z';
const doc = (lines: Partial<Line>[], kind: DocumentFile['kind'] = 'script'): DocumentFile => ({
  schema: 1, id: 'doc', projectId: 'p', kind, name: 'Script', settings: defaultDocumentSettings(),
  lines: lines.map((l, i) => ({ id: l.id ?? `l${i}`, type: 'action', text: '', createdAt: at, updatedAt: at, ...l })) as Line[],
  sceneNumbers: { enabled: false, locked: false }, revision: { tracking: false, color: 'Blue' }, updatedAt: at,
});

const script = doc(golden.elements as Partial<Line>[]);
const settings = defaultSettings();
const opts = { includeTitlePage: false, sceneNumbers: false, revisionAsterisks: true, includeNotes: false };

describe('PDF export', () => {
  it('draws every row exactly where the layout engine put it', async () => {
    const bytes = await buildPdf({ title: 'Golden', script, settings, options: opts });
    const pages = await extractPdfPages(bytes.slice(), pdfjs as any);
    const { result } = layoutForPrint(script, settings, opts);
    expect(pages.length).toBe(result.pages.length);
    result.pages.forEach((lp, pi) => {
      const got = pages[pi].lines;
      for (const r of lp.rows) {
        if (!r.text.trim()) continue;
        const x = r.col * LETTER.charPt;
        const y = LETTER.heightPt - (LETTER.topPt + r.row * LETTER.linePt + LETTER.baselinePt);
        const hit = got.find((g) => Math.abs(g.y - y) < 1.01 && Math.abs(g.x - x) < 0.6);
        expect(hit, `page ${pi + 1} row ${r.row} "${r.text}"`).toBeTruthy();
        expect(hit!.text.replace(/\s+/g, ' ')).toContain(r.text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 20));
      }
    });
  });

  it('matches the positions WriterDuet printed', async () => {
    const bytes = await buildPdf({ title: 'Golden', script, settings, options: opts });
    const pages = await extractPdfPages(bytes.slice(), pdfjs as any);
    // First body line at 1.5 in from the left with its baseline 80.25 pt from the top.
    const first = pages[0].lines[0];
    expect(first.x).toBeCloseTo(108, 0);
    expect(792 - first.y).toBeCloseTo(80.25, 0);
    // Page 2 has its number at x = 540 pt, baseline 44.25 pt.
    const num = pages[1].lines[0];
    expect(num.text).toBe('2.');
    expect(num.x).toBeCloseTo(540, 0);
    expect(792 - num.y).toBeCloseTo(44.25, 0);
    // No number on page 1.
    expect(pages[0].lines.some((l) => l.text === '1.')).toBe(false);
  });

  it('adds an unnumbered title page laid out like WriterDuet', async () => {
    const tp = doc(defaultTitlePageLines('We Will See', settings.pdf), 'titlePage');
    const bytes = await buildPdf({ title: 'We Will See', script, titlePage: tp, settings, options: { ...opts, includeTitlePage: true } });
    const pages = await extractPdfPages(bytes.slice(), pdfjs as any);
    const { result } = layoutForPrint(script, settings, opts);
    expect(pages.length).toBe(result.pages.length + 1);
    const t = pages[0].lines;
    expect(t.map((l) => l.text)).toEqual(['WE WILL SEE', 'written by', 'Markandeya Yalamanchi']);
    expect(t.map((l) => Math.round((792 - l.y) * 100) / 100)).toEqual([284.25, 332.25, 368.25]);
    // WriterDuet printed the title at x = 246.75 pt.
    expect(t[0].x - (17 - 11) * 3.6).toBeCloseTo(246.75, 0);
    // Centered like WriterDuet's title page.
    for (const l of t) expect((l.x + l.right) / 2).toBeCloseTo(308, 0);
  });

  it('prints scene numbers, revision asterisks and notes only when asked', async () => {
    const d = doc([
      { type: 'scene', text: 'INT. A - DAY' }, { type: 'action', text: 'Changed line.', revisionMarked: true },
      { type: 'note', text: 'A private note.' }, { type: 'scene', text: 'INT. B - DAY' },
    ]);
    d.sceneNumbers.enabled = true;
    const read = async (o: typeof opts) => (await extractPdfPages((await buildPdf({ title: 'T', script: d, settings, options: o })).slice(), pdfjs as any))[0].lines.map((l) => l.text).join('\n');
    const plain = await read({ ...opts, revisionAsterisks: false });
    expect(plain).not.toContain('A private note.');
    expect(plain).not.toContain('*');
    const full = await read({ ...opts, sceneNumbers: true, includeNotes: true });
    expect(full).toContain('A private note.');
    expect(full).toMatch(/1\s+INT\. A - DAY\s+1/);
    expect(full).toMatch(/Changed line\.\s+\*/);
  });

  it('honors a page range', async () => {
    const bytes = await buildPdf({ title: 'G', script, settings, options: { ...opts, pageFrom: 2, pageTo: 3 } });
    const pages = await extractPdfPages(bytes.slice(), pdfjs as any);
    expect(pages.length).toBe(2);
    expect(pages[0].lines[0].text).toBe('2.');
  });
});

describe('PDF import', () => {
  it('round-trips element types through export and import', async () => {
    const src = doc([
      { type: 'scene', text: 'INT. KITCHEN - DAY' },
      { type: 'action', text: 'A long action paragraph that runs past the end of the first line so that it has to wrap onto a second line for sure.' },
      { type: 'character', text: 'MAYA' }, { type: 'parenthetical', text: '(quietly)' },
      { type: 'dialogue', text: 'Did you call the guy about the Austin thing? It has been four months now and I am worried.' },
      { type: 'character', text: 'ROY' }, { type: 'dialogue', text: 'A couple things are moving.' },
      { type: 'transition', text: 'CUT TO:' },
      { type: 'scene', text: 'EXT. STREET - NIGHT' }, { type: 'action', text: 'Rain.' },
    ]);
    const bytes = await buildPdf({ title: 'Round Trip', script: src, settings, options: opts });
    const out = classifyPdf(await extractPdfPages(bytes.slice(), pdfjs as any));
    expect(out.lines.map((l) => l.type)).toEqual(src.lines.map((l) => l.type));
    expect(out.lines.map((l) => l.text)).toEqual(src.lines.map((l) => l.text));
  });

  it('drops page numbers, MORE and CONTD and rejoins split dialogue', async () => {
    const bytes = await buildPdf({ title: 'Golden', script, settings, options: opts });
    const out = classifyPdf(await extractPdfPages(bytes.slice(), pdfjs as any));
    const texts = out.lines.map((l) => l.text);
    expect(texts.some((t) => /^\d+\.$/.test(t))).toBe(false);
    expect(texts.some((t) => /MORE\)|CONT'D/.test(t))).toBe(false);
    const count = (ls: { type: string }[], t: string) => ls.filter((l) => l.type === t).length;
    // Scene headings in the fixture are scrambled, so they read as action here.
    expect(count(out.lines, 'character')).toBe(count(golden.elements, 'character'));
    expect(count(out.lines, 'transition')).toBe(count(golden.elements, 'transition'));
  });
});

describe('text imports', () => {
  const lines = [
    { type: 'scene' as const, text: 'INT. HOUSE - DAY' }, { type: 'action' as const, text: 'Bob walks in.' },
    { type: 'character' as const, text: 'BOB' }, { type: 'parenthetical' as const, text: '(tired)' }, { type: 'dialogue' as const, text: 'Hello there.' },
    { type: 'transition' as const, text: 'CUT TO:' }, { type: 'scene' as const, text: 'EXT. YARD - NIGHT' }, { type: 'note' as const, text: 'Fix this.' },
  ];

  it('round-trips Fountain', () => {
    const r = parseFountain(toFountain(lines, 'My Title'));
    expect(r.title).toBe('My Title');
    expect(r.lines).toEqual(lines);
  });

  it('parses Fountain dual dialogue and forced elements', () => {
    const r = parseFountain('.FLASHBACK\n\nBOB\nHi.\n\nAMY ^\nHey.\n\n> FADE OUT.\n');
    expect(r.lines.map((l) => [l.type, l.dual ?? ''])).toEqual([['scene', ''], ['character', 'left'], ['dialogue', 'left'], ['character', 'right'], ['dialogue', 'right'], ['transition', '']]);
  });

  it('parses Final Draft FDX including dual dialogue', () => {
    const fdx = `<?xml version="1.0"?><FinalDraft DocumentType="Script"><Content>
      <Paragraph Type="Scene Heading"><Text>INT. LAB &amp; OFFICE - DAY</Text></Paragraph>
      <Paragraph Type="Action"><Text>She </Text><Text Style="Bold">runs</Text><Text>.</Text></Paragraph>
      <Paragraph><DualDialogue>
        <Paragraph Type="Character"><Text>ANN</Text></Paragraph><Paragraph Type="Dialogue"><Text>Left.</Text></Paragraph>
        <Paragraph Type="Character"><Text>BEN</Text></Paragraph><Paragraph Type="Dialogue"><Text>Right.</Text></Paragraph>
      </DualDialogue></Paragraph>
      <Paragraph Type="Transition"><Text>CUT TO:</Text></Paragraph>
    </Content><TitlePage><Content><Paragraph><Text>THE TITLE</Text></Paragraph></Content></TitlePage></FinalDraft>`;
    const r = parseFdx(fdx);
    expect(r.title).toBe('THE TITLE');
    expect(r.lines).toEqual([
      { type: 'scene', text: 'INT. LAB & OFFICE - DAY' }, { type: 'action', text: 'She runs.' },
      { type: 'character', text: 'ANN', dual: 'left' }, { type: 'dialogue', text: 'Left.', dual: 'left' },
      { type: 'character', text: 'BEN', dual: 'right' }, { type: 'dialogue', text: 'Right.', dual: 'right' },
      { type: 'transition', text: 'CUT TO:' },
    ]);
  });

  it('sniffs formats and reads scripts inside a zip archive', () => {
    expect(importText('<FinalDraft><Content><Paragraph Type="Action"><Text>Hi.</Text></Paragraph></Content></FinalDraft>').format).toContain('FDX');
    expect(importText('INT. A - DAY\n\nAction.\n').lines[0].type).toBe('scene');
    const zip = zipSync({ 'script.fountain': strToU8('INT. ZIP - DAY\n\nInside.\n') });
    const r = importBytes(zip, 'backup.wdz');
    expect(r.lines.map((l) => l.text)).toEqual(['INT. ZIP - DAY', 'Inside.']);
    const json = importText(JSON.stringify({ title: 'J', lines: [{ type: 'Slugline', text: 'INT. J - DAY' }, { type: 'EditDialogName', text: 'JO' }, { type: 'EditDialogContent', text: 'Hi<br>there' }] }));
    expect(json.lines.map((l) => l.type)).toEqual(['scene', 'character', 'dialogue']);
  });
});

describe('scene numbers and analysis', () => {
  it('numbers scenes in order, and adds letters when locked', () => {
    const ls = [{ id: 'a', type: 'scene' }, { id: 'x', type: 'action' }, { id: 'b', type: 'scene' }];
    expect([...computeSceneNumbers(ls, { locked: false, start: 5 }).values()]).toEqual(['5', '6']);
    const locked = [{ id: 'a', type: 'scene', sceneNumber: '12' }, { id: 'n1', type: 'scene' }, { id: 'n2', type: 'scene' }, { id: 'b', type: 'scene', sceneNumber: '13' }];
    expect([...computeSceneNumbers(locked, { locked: true, start: 1 }).values()]).toEqual(['12', '12A', '12B', '13']);
  });

  it('computes document statistics', () => {
    const ls = (golden.elements as { id: string; type: any; text: string }[]);
    const st = documentStats(ls, 10);
    expect(st.pages).toBe(10);
    expect(st.scenes).toBe(splitScenes(ls).length);
    expect(st.dialoguePct + st.actionPct).toBeGreaterThanOrEqual(99);
    expect(st.byCharacter.length).toBeGreaterThan(3);
    expect(st.runtimeMin).toBe(10);
  });
});
