import { type Page, expect, test } from '@playwright/test';

const editor = '[data-testid=editor]';

async function newProject(page: Page, name: string) {
  await page.goto('/');
  await page.getByTestId('new-project').click();
  await page.getByTestId('prompt-input').fill(name);
  await page.getByTestId('prompt-ok').click();
  await page.waitForSelector(editor);
  await page.click(editor);
}

const lines = (page: Page) => page.evaluate(() => {
  const out: [string, string][] = [];
  (window as any).__udView.state.doc.forEach((n: any) => out.push([n.type.name === 'general' ? 'text' : n.type.name, n.textContent]));
  return out;
});

async function menu(page: Page, top: string, ...items: string[]) {
  await page.getByTestId('menubar').getByText(top, { exact: true }).dispatchEvent('mousedown');
  for (const [i, item] of items.entries()) {
    const el = page.getByRole('menuitem', { name: item, exact: false }).first();
    if (i < items.length - 1) await el.hover(); else await el.click();
  }
}

async function typeScene(page: Page) {
  const k = page.keyboard;
  await k.type('int. kitchen - day');
  await k.press('Enter');
  await k.type('maya scrubs dishes. roy watches the TV.');
  await k.press('Enter');
  await k.press('Tab');
  await k.type('maya');
  await k.press('Enter');
  await k.type('did you call the guy?');
  await k.press('Enter');
  await k.type('roy');
  await k.press('Enter');
  await k.type("it's a stupid startup.");
}

test.describe('writing', () => {
  test('types a scene with Enter and Tab flow', async ({ page }) => {
    await newProject(page, 'Flow Test');
    await typeScene(page);
    expect(await lines(page)).toEqual([
      ['scene', 'Int. kitchen - day'],
      ['action', 'Maya scrubs dishes. Roy watches the TV.'],
      ['character', 'maya'],
      ['dialogue', 'Did you call the guy?'],
      ['character', 'roy'],
      ['dialogue', "It's a stupid startup."],
    ]);
    // Scene and character lines display in uppercase.
    await expect(page.locator('.el-scene').first()).toHaveCSS('text-transform', 'uppercase');
    await expect(page.locator('.el-character').first()).toHaveCSS('text-transform', 'uppercase');
    // Toolbar shows the current element.
    await expect(page.getByTestId('el-dialogue')).toHaveAttribute('data-active', 'true');
    // Enter on an empty dialogue line goes to action; Tab on empty action goes to character.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('el-action')).toHaveAttribute('data-active', 'true');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('el-character')).toHaveAttribute('data-active', 'true');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('el-transition')).toHaveAttribute('data-active', 'true');
    await page.keyboard.type('cut to:');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('el-scene')).toHaveAttribute('data-active', 'true');
  });

  test('typing rules: parenthetical, transition, element shortcuts', async ({ page }) => {
    await newProject(page, 'Rules');
    const k = page.keyboard;
    await k.press('Control+3');
    await k.type('ann');
    await k.press('Enter');
    await k.type('(');
    await expect(page.getByTestId('el-parenthetical')).toHaveAttribute('data-active', 'true');
    await k.type('softly)');
    await k.press('Enter');
    await k.type('hello.');
    await k.press('Control+2');
    await expect(page.getByTestId('el-action')).toHaveAttribute('data-active', 'true');
    await k.press('Enter');
    await k.type('SMASH CUT TO:');
    await expect(page.getByTestId('el-transition')).toHaveAttribute('data-active', 'true');
    expect(await lines(page)).toEqual([['character', 'ann'], ['parenthetical', '(softly)'], ['action', 'Hello.'], ['transition', 'SMASH CUT TO:']]);
  });

  test('autocompletes characters, scene intros and times', async ({ page }) => {
    await newProject(page, 'Autocomplete');
    await typeScene(page);
    const k = page.keyboard;
    await k.press('Enter');
    await k.type('m');
    const ac = page.getByTestId('autocomplete');
    await expect(ac).toBeVisible();
    await expect(ac.locator('.ac-item').first()).toHaveText('MAYA');
    await k.press('Enter');
    await k.type('fine.');
    await k.press('Enter');
    await k.press('Enter'); // empty character -> action
    await k.press('Control+1');
    await k.type('e');
    await expect(ac.locator('.ac-item').first()).toHaveText('EXT.');
    await k.press('Tab');
    await k.type('k');
    await expect(ac.locator('.ac-item').first()).toHaveText('KITCHEN');
    await k.press('Tab');
    await k.type('n');
    await expect(ac.locator('.ac-item').first()).toHaveText('NIGHT');
    await k.press('Tab');
    const all = await lines(page);
    expect(all.slice(-3)).toEqual([['character', 'MAYA'], ['dialogue', 'Fine.'], ['scene', 'EXT. KITCHEN - NIGHT']]);
    // Extensions after a character name.
    await k.press('Enter');
    await k.press('Control+3');
    await k.type('roy (v');
    await expect(ac.locator('.ac-item').first()).toHaveText('(V.O.)');
    await k.press('Tab');
    expect((await lines(page)).at(-1)).toEqual(['character', 'roy (V.O.)']);
  });

  test('dual dialogue sits side by side and can be exited', async ({ page }) => {
    await newProject(page, 'Dual');
    await typeScene(page);
    await page.keyboard.press('Control+d');
    const left = page.locator('.el-character[data-dual=left]');
    const right = page.locator('.el-character[data-dual=right]');
    await expect(left).toHaveCount(1);
    await expect(right).toHaveCount(1);
    const a = (await left.boundingBox())!, b = (await right.boundingBox())!;
    expect(Math.abs(a.y - b.y)).toBeLessThan(2);
    expect(b.x).toBeGreaterThan(a.x + 200);
    await expect(page.getByTestId('el-dual')).toHaveClass(/Active/);
    await page.keyboard.press('Control+e');
    await expect(page.locator('.el[data-dual]')).toHaveCount(0);
  });

  test('automatic CONTD, undo, move lines', async ({ page }) => {
    await newProject(page, 'Contd');
    const k = page.keyboard;
    await k.press('Control+3'); await k.type('bob'); await k.press('Enter'); await k.type('one.'); await k.press('Enter');
    await k.press('Enter'); await k.type('he waits.'); await k.press('Enter'); await k.press('Tab');
    await k.type('bob'); await k.press('Escape'); await k.press('Enter'); await k.type('two.');
    await page.waitForTimeout(700); // let the undo history close the typing group
    await expect(page.locator('.el-character.contd')).toHaveCount(1);
    await k.press('Alt+ArrowUp');
    expect((await lines(page)).map((l) => l[1])).toEqual(['bob', 'One.', 'He waits.', 'Two.', 'bob']);
    await k.press('Control+z');
    expect((await lines(page)).map((l) => l[1])).toEqual(['bob', 'One.', 'He waits.', 'bob', 'Two.']);
  });
});

test.describe('pages and PDF', () => {
  test('the browser wraps every line exactly like the layout engine', async ({ page }) => {
    await newProject(page, 'Wrap Check');
    const bad = await page.evaluate(() => {
      const view = (window as any).__udView;
      const s = view.state.schema;
      // Deterministic pseudo-random text with tricky spots: long words, hyphens, slashes, punctuation, double spaces.
      let seed = 42;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const words = ['a', 'I', 'to', 'the', 'and', 'Roy', 'kitchen', 'one-handed', 't-shirt', 'INT./EXT.', "doesn't", 'counter.', 'laughing,', 'what?!', 'seed-stage', 'top-tier', 'unbelievable', '(beat)', 'so--wait', 'Mistral', 'x'.repeat(70), 'well...', '9-5', '"quoted"', 'either/or', 'back.Then', '$40', 'it;', 'wow:', '50%'];
      const text = () => { let t = ''; const n = 3 + Math.floor(rnd() * 40); for (let i = 0; i < n; i++) t += (i ? (rnd() < 0.06 ? '  ' : ' ') : '') + words[Math.floor(rnd() * words.length)]; return t; };
      const types = ['action', 'dialogue', 'parenthetical', 'scene', 'character', 'transition', 'general', 'lyrics', 'shot'];
      const nodes = [];
      for (let i = 0; i < 400; i++) nodes.push(s.nodes[types[i % types.length]].create({}, s.text(text())));
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, nodes));
      const info = (window as any).__ud.layoutKey.getState(view.state).result.info;
      const out: string[] = [];
      view.state.doc.forEach((n: any, pos: number) => {
        const dom = view.nodeDOM(pos) as HTMLElement;
        const li = info.get(n.attrs.id);
        const cs = getComputedStyle(dom);
        const breaks = dom.querySelectorAll('.pb').length;
        let h = dom.getBoundingClientRect().height - parseFloat(cs.paddingTop);
        dom.querySelectorAll('.pb').forEach((b) => { h -= (b as HTMLElement).getBoundingClientRect().height; });
        const rows = Math.round(h / 16);
        if (rows !== li.rows) out.push(`${n.type.name} rows dom=${rows} engine=${li.rows} breaks=${breaks}: ${n.textContent.slice(0, 80)}`);
      });
      return out;
    });
    expect(bad).toEqual([]);
  });

  test('paginates like the PDF and exports a PDF', async ({ page }) => {
    await newProject(page, 'Paging');
    await page.evaluate(() => {
      const view = (window as any).__udView;
      const s = view.state.schema;
      const nodes = [];
      for (let i = 0; i < 70; i++) nodes.push(s.nodes.action.create({}, s.text(`Line number ${i + 1} of the action.`)));
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, nodes));
    });
    await expect(page.locator('.pb')).toHaveCount(2);
    await expect(page.locator('.pb-num').first()).toHaveText('2.');
    // Each page is exactly 1056 px tall with a 20 px gap.
    const tops = await page.locator('.pb-gap').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top + document.querySelector('[data-testid=scroller]')!.scrollTop));
    expect(Math.round(tops[1] - tops[0])).toBe(1076);
    await page.locator('.el').last().click();
    await expect(page.getByTestId('page-count')).toHaveText('3 of 3');

    const download = page.waitForEvent('download');
    await page.getByTestId('quick-export').click();
    const d = await download;
    expect(d.suggestedFilename()).toMatch(/^Paging - \d{4}-\d{2}-\d{2}\.pdf$/);
    const info = await page.evaluate(() => (window as any).__lastDownload);
    expect(info.size).toBeGreaterThan(8000);
  });

  test('export dialog, title page navigation and dark mode', async ({ page }) => {
    await newProject(page, 'Title Nav');
    await page.getByTestId('to-title-page').click();
    await expect(page.getByText("You're editing the title page.")).toBeVisible();
    await expect(page.locator('.el', { hasText: 'TITLE NAV' })).toBeVisible();
    await expect(page.locator('.el', { hasText: 'written by' })).toHaveAttribute('data-align', 'center');
    await page.getByTestId('to-script').click();
    await expect(page.getByTestId('to-title-page')).toBeVisible();

    await menu(page, 'View', 'Dark Mode');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const bg = await page.locator('.pm-page').evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(bg).not.toBe('rgb(255, 255, 255)');
    await menu(page, 'View', 'Dark Mode');

    await menu(page, 'File', 'Export...');
    const download = page.waitForEvent('download');
    await page.getByTestId('export-go').click();
    expect((await download).suggestedFilename()).toContain('Title Nav');
  });
});

test.describe('tools', () => {
  test('comments, find and replace, rename character', async ({ page }) => {
    await newProject(page, 'Tools');
    await typeScene(page);
    await page.getByTestId('rail-comments').click();
    await page.getByTestId('comment-input').fill('Punch this line up.');
    await page.getByTestId('comment-add').click();
    await expect(page.getByTestId('comment')).toHaveCount(1);
    await expect(page.locator('.cmt')).toHaveCount(1);
    await page.getByText('Resolve').click();
    await expect(page.locator('.cmt')).toHaveCount(0);

    await page.click(editor);
    await page.keyboard.press('Control+f');
    await page.getByTestId('find-input').fill('the');
    await expect(page.getByTestId('find-count')).toHaveText('1 of 2');
    await expect(page.locator('.find-hit')).toHaveCount(2);
    await page.getByTestId('replace-input').fill('THAT');
    await page.getByTestId('replace-all').click();
    expect((await lines(page))[1][1]).toBe('Maya scrubs dishes. Roy watches THAT TV.');
    await page.getByTestId('find-close').click();

    await menu(page, 'Tools', 'Rename Character...');
    await page.getByTestId('rename-old').selectOption('MAYA');
    await page.getByTestId('rename-new').fill('Nina');
    await expect(page.getByTestId('rename-preview')).toContainText('1 character line and 1 mention');
    await page.getByTestId('rename-apply').click();
    const out = await lines(page);
    expect(out[1][1]).toBe('Nina scrubs dishes. Roy watches THAT TV.');
    expect(out[2][1]).toBe('NINA');
  });

  test('cards, reports, scene numbers and go to', async ({ page }) => {
    await newProject(page, 'Reports');
    await typeScene(page);
    const k = page.keyboard;
    await k.press('Enter'); await k.press('Enter'); await k.press('Control+1');
    await k.type('ext. street - night'); await k.press('Enter'); await k.type('rain.');
    await page.waitForTimeout(900);

    await page.getByTestId('rail-cards').click();
    await expect(page.getByTestId('card')).toHaveCount(2);
    await menu(page, 'View', 'Card View');
    await expect(page.getByTestId('cards').last().getByTestId('card')).toHaveCount(2);
    await page.getByTestId('card').last().click();
    await expect(page.getByTestId('el-scene')).toHaveAttribute('data-active', 'true');

    await menu(page, 'Reports', 'Document Statistics...');
    await expect(page.getByTestId('stats')).toContainText('2');
    await expect(page.getByRole('dialog')).toContainText('MAYA');
    await page.getByTestId('dialog-close').click();

    await menu(page, 'Reports', 'Dialogue Filter...');
    await page.getByTestId('report-show').click();
    await expect(page.getByTestId('filter-bar')).toContainText('Dialogue only');
    await expect(page.locator('.el-action:not(.el-hidden)')).toHaveCount(0);
    await page.getByText('Show everything').click();
    await expect(page.locator('.el-action:not(.el-hidden)')).toHaveCount(2);

    await menu(page, 'Production', 'Scene Numbers...');
    await page.getByTestId('scene-numbers-on').check();
    await page.getByTestId('scene-numbers-apply').click();
    await expect(page.locator('.el-scene[data-snl="2"]')).toHaveCount(1);

    await page.click(editor);
    await page.keyboard.press('Control+g');
    await page.getByTestId('goto-scene').fill('1');
    await page.getByTestId('goto-ok').click();
    await expect(page.locator('.el.cur')).toContainText(/kitchen/i);
  });

  test('revisions, snapshots and line history', async ({ page }) => {
    await newProject(page, 'Revisions');
    await typeScene(page);
    await page.waitForTimeout(900);
    await menu(page, 'Revisions', 'Save Snapshot');
    await page.getByTestId('snapshot-name').fill('First pass');
    await page.getByTestId('snapshot-save').click();

    await menu(page, 'Revisions', 'View & Track...');
    await page.getByTestId('track-on').check();
    await page.getByTestId('track-color').selectOption('Blue');
    await page.getByTestId('track-apply').click();
    await page.locator('.el-dialogue').last().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Really.');
    await expect(page.locator('.el[data-rev=Blue]')).toHaveCount(1);
    await expect(page.locator('.rev-mark')).toHaveCount(1);
    await page.waitForTimeout(900);

    await menu(page, 'Revisions', 'Document Snapshots');
    await expect(page.getByTestId('snapshot-item')).toHaveCount(1);
    await page.getByTestId('snapshot-compare-btn').click();
    await expect(page.getByTestId('snapshot-compare')).toContainText('Really.');
    await page.getByTestId('dialog-close').click();

    await menu(page, 'Revisions', 'Accept/Reject...');
    await expect(page.getByTestId('change-count')).toContainText('Change 1 of 1');
    await page.getByTestId('reject-one').click();
    await expect(page.getByTestId('no-changes')).toBeVisible();
    await page.getByTestId('dialog-close').click();
    expect((await lines(page)).at(-1)![1]).toBe("It's a stupid startup.");
  });
});

test.describe('library and storage', () => {
  test('keeps work across reloads, works offline, and searches every script', async ({ page, context }) => {
    await newProject(page, 'Offline Script');
    await typeScene(page);
    await page.waitForTimeout(1000);
    // Wait for the service worker so the shell loads with no network.
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await page.waitForSelector(editor);
    expect((await lines(page)).length).toBe(6);

    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector(editor);
    await page.locator('.el-dialogue').last().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Still offline.');
    await page.waitForTimeout(1000);
    await page.reload();
    await page.waitForSelector(editor);
    expect((await lines(page)).at(-1)![1]).toBe("It's a stupid startup. Still offline.");
    await expect(page.getByTestId('save-status')).not.toHaveAttribute('data-state', 'synced');
    await context.setOffline(false);

    await page.getByTestId('open-library').click();
    await expect(page.getByTestId('project-card')).toHaveCount(1);
    await page.getByTestId('library-search').fill('stupid startup');
    await expect(page.getByTestId('search-hit').first()).toContainText('stupid');
    await page.getByTestId('search-hit').first().click();
    await page.waitForSelector(editor);
    await expect(page.locator('.el.cur')).toContainText('stupid startup');
  });

  test('folders, unlimited projects, rename and remove', async ({ page }) => {
    await page.goto('/');
    for (const n of ['One', 'Two', 'Three', 'Four', 'Five']) {
      await page.getByTestId('new-project').click();
      await page.getByTestId('prompt-input').fill(n);
      await page.getByTestId('prompt-ok').click();
      await page.waitForSelector(editor);
      await page.getByTestId('open-library').click();
    }
    await expect(page.getByTestId('project-card')).toHaveCount(5);
    await page.getByTestId('new-folder').click();
    await page.getByTestId('prompt-input').fill('Features');
    await page.getByTestId('prompt-ok').click();
    await expect(page.getByTestId('folder')).toHaveCount(1);
    const card = page.getByTestId('project-card').filter({ hasText: 'Three' });
    await card.dragTo(page.getByTestId('folder'));
    await page.getByTestId('folder').click();
    await expect(page.getByTestId('project-card')).toHaveCount(1);
    await expect(page.getByTestId('project-card')).toContainText('Three');
  });

  test('imports a Fountain file as a new project', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Import', { exact: true }).click();
    await page.getByTestId('import-file').setInputFiles({
      name: 'Night Shift.fountain', mimeType: 'text/plain',
      buffer: Buffer.from('Title: Night Shift\n\nINT. DINER - NIGHT\n\nA waitress pours coffee.\n\nJUNE\nMore?\n\nCUT TO:\n'),
    });
    await expect(page.getByTestId('import-preview')).toContainText('INT. DINER - NIGHT');
    await page.getByTestId('import-create').click();
    await page.waitForSelector(editor);
    expect(await lines(page)).toEqual([['scene', 'INT. DINER - NIGHT'], ['action', 'A waitress pours coffee.'], ['character', 'JUNE'], ['dialogue', 'More?'], ['transition', 'CUT TO:']]);
  });

  test('imports a PDF script', async ({ page }) => {
    await newProject(page, 'Pdf Source');
    await typeScene(page);
    await page.waitForTimeout(900);
    const bytes: number[] = await page.evaluate(async () => Array.from((await (window as any).__ud.makePdf({ includeTitlePage: false })).bytes));
    await page.getByTestId('open-library').click();
    await page.getByText('Import', { exact: true }).click();
    await page.getByTestId('import-file').setInputFiles({ name: 'Copy.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
    await expect(page.getByTestId('import-preview')).toContainText('INT. KITCHEN - DAY');
    await page.getByTestId('import-create').click();
    await page.waitForSelector(editor);
    expect((await lines(page)).map((l) => l[0])).toEqual(['scene', 'action', 'character', 'dialogue', 'character', 'dialogue']);
  });
});

test.describe('performance', () => {
  test('typing stays under 16 ms per keystroke in a 120 page script', async ({ page }) => {
    await newProject(page, 'Big Script');
    const pages = await page.evaluate(() => {
      const view = (window as any).__udView;
      const s = view.state.schema;
      const nodes = [];
      for (let sc = 0; sc < 135; sc++) {
        nodes.push(s.nodes.scene.create({}, s.text(`INT. LOCATION ${sc} - DAY`)));
        for (let k = 0; k < 6; k++) {
          nodes.push(s.nodes.action.create({}, s.text('Somebody walks into the room and looks around for a while. Then they sit down and wait for the other person.')));
          nodes.push(s.nodes.character.create({}, s.text(k % 2 ? 'ALEX' : 'JORDAN')));
          nodes.push(s.nodes.dialogue.create({}, s.text('I have been thinking about what you said. It does not add up, and I think you know that as well as I do.')));
        }
      }
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, nodes));
      return document.querySelectorAll('.pb').length + 1;
    });
    expect(pages).toBeGreaterThanOrEqual(120);
    // Type in the middle of the script and time each keystroke end to end (transaction, layout, DOM update).
    const stats = await page.evaluate(async () => {
      const view = (window as any).__udView;
      const { TextSelection } = (window as any).__ud.pm;
      let pos = 0, i = 0;
      view.state.doc.forEach((n: any, p: number) => { if (i++ === 1300) pos = p + n.nodeSize - 1; });
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)).scrollIntoView());
      view.focus();
      await new Promise((r) => setTimeout(r, 300));
      const times: number[] = [];
      for (const ch of ' The quick brown fox jumps over the lazy dog and keeps typing more words here.') {
        const t0 = performance.now();
        view.dispatch(view.state.tr.insertText(ch));
        void view.dom.offsetHeight; // force layout so DOM cost is included
        times.push(performance.now() - t0);
        await new Promise((r) => requestAnimationFrame(r));
      }
      times.sort((a, b) => a - b);
      return { median: times[Math.floor(times.length / 2)], p90: times[Math.floor(times.length * 0.9)], max: times[times.length - 1] };
    });
    console.log('keystroke ms', stats);
    expect(stats.median).toBeLessThan(16);
    expect(stats.p90).toBeLessThan(16);
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 780 } });
  test('library works, script opens read-only with Export PDF first', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('new-project').click();
    await page.getByTestId('prompt-input').fill('Phone Script');
    await page.getByTestId('prompt-ok').click();
    await expect(page.getByTestId('phone-shell')).toBeVisible();
    await expect(page.getByTestId('phone-export')).toBeVisible();
    await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');
    await page.getByTestId('phone-edit').click();
    await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true');
    await expect(page.getByTestId('phone-picker')).toBeVisible();
    await page.click(editor);
    await page.keyboard.type('quick fix');
    await page.getByTestId('phone-picker').getByText('Scene').click();
    expect(await lines(page)).toEqual([['scene', 'Quick fix']]);
    const download = page.waitForEvent('download');
    await page.getByTestId('phone-export').click();
    expect((await download).suggestedFilename()).toContain('Phone Script');
    await page.getByTestId('phone-menu').click();
    await expect(page.getByTestId('phone-sheet')).toContainText('Quick Export (PDF)');
  });
});
