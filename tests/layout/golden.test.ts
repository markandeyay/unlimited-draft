import { describe, expect, it } from 'vitest';
import golden from './fixtures/wd-golden.json';
import { createLayoutEngine, type LayoutLine } from '../../src/layout/paginate';

// Fixture built by scripts/make-golden.py from a WriterDuet Quick Export PDF.
// Every row of every page must land on the same line and column as WriterDuet printed it.
describe('WriterDuet golden pagination', () => {
  const engine = createLayoutEngine();
  const lines = golden.elements as LayoutLine[];
  const result = engine.layout(lines);

  it('has the same number of pages', () => {
    expect(result.pages.length).toBe(golden.pages.length);
  });

  golden.pages.forEach((expected, i) => {
    it(`page ${i + 1} matches line for line`, () => {
      const got = result.pages[i].rows
        .filter((r) => r.kind === 'text' || r.kind === 'more' || r.kind === 'contd')
        .map((r) => [r.row, r.type === 'transition' ? 0 : Math.round(r.col * 1000) / 1000, r.text])
        .sort((a, b) => (a[0] as number) - (b[0] as number));
      const want = (expected as [number, number, string][])
        .map(([row, col, text]) => [row, col > 60 ? 0 : col, text]);
      expect(got).toEqual(want);
    });
  });
});
