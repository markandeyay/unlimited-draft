import { type Page, expect, test } from '@playwright/test';

const editor = '[data-testid=editor]';

async function projectWithTwoScenes(page: Page, name: string) {
  await page.goto('/');
  await page.getByTestId('new-project').click();
  await page.getByTestId('prompt-input').fill(name);
  await page.getByTestId('prompt-ok').click();
  await page.waitForSelector(editor);
  await page.evaluate(() => {
    const v = (window as any).__udView, s = v.state.schema;
    const L = (t: string, x: string) => s.nodes[t].create({}, s.text(x));
    v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, [
      L('scene', 'INT. KITCHEN - DAY'), L('action', 'Maya scrubs dishes.'), L('character', 'MAYA'), L('dialogue', 'Shoes, Arjun.'),
      L('scene', 'EXT. STREET - NIGHT'), L('action', 'Rain on the car.'), L('action', 'Roy gets out.'),
    ]));
  });
  await page.waitForTimeout(900);
}

test.describe('small details', () => {
  test('a scene collapses and expands from the arrow beside its heading', async ({ page }) => {
    await projectWithTwoScenes(page, 'Collapse');
    const first = page.locator('.el-scene').first();
    const arrow = first.getByTestId('fold');
    // Hidden until the heading is hovered.
    await page.locator('.el-action').last().click();
    await expect(arrow).toBeHidden();
    await first.hover();
    await expect(arrow).toBeVisible();
    const box = (await first.boundingBox())!;
    const ab = (await arrow.boundingBox())!;
    expect(Math.round(box.x - ab.x)).toBe(28);

    await arrow.click();
    await expect(first).toHaveClass(/folded/);
    await expect(page.locator('.el-action:not(.el-hidden)')).toHaveCount(2);
    await expect(page.locator('.el-character:not(.el-hidden)')).toHaveCount(0);
    // The arrow stays visible while collapsed, and the next scene moves up under the heading.
    await page.locator('.el-action').last().click();
    await expect(arrow).toBeVisible();
    const second = (await page.locator('.el-scene').nth(1).boundingBox())!;
    expect(Math.round(second.y - box.y)).toBe(16); // the next heading's box starts right under this one (its two blank lines are inside it)

    // Collapsed state survives a reload and does not change the script itself.
    await page.reload();
    await page.waitForSelector(editor);
    await expect(page.locator('.el-scene').first()).toHaveClass(/folded/);
    expect(await page.evaluate(() => (window as any).__udView.state.doc.childCount)).toBe(7);

    await page.locator('.el-scene').first().getByTestId('fold').click();
    await expect(page.locator('.el-character:not(.el-hidden)')).toHaveCount(1);
  });

  test('the cursor leaves a scene when it is collapsed around it', async ({ page }) => {
    await projectWithTwoScenes(page, 'Collapse Cursor');
    await page.locator('.el-dialogue').first().click();
    await page.locator('.el-scene').first().hover();
    await page.locator('.el-scene').first().getByTestId('fold').click();
    await expect(page.locator('.el.cur')).toHaveText(/INT\. KITCHEN - DAY/);
    await page.keyboard.type(' X');
    expect(await page.evaluate(() => (window as any).__udView.state.doc.firstChild.textContent)).toBe('INT. KITCHEN - DAY X');
  });

  test('hover band, margin comment button and tooltips', async ({ page }) => {
    await projectWithTwoScenes(page, 'Hover');
    await page.locator('.el-action').last().click();
    const line = page.locator('.el-action').first();
    await line.hover();
    await expect(line).toHaveCSS('background-color', 'rgba(175, 180, 43, 0.06)');
    const btn = page.getByTestId('gutter-comment');
    await expect(btn).toBeVisible();
    const lb = (await line.boundingBox())!, bb = (await btn.boundingBox())!;
    expect(Math.abs(bb.y + bb.height / 2 - (lb.y + lb.height - 8))).toBeLessThan(3);
    await btn.click();
    await expect(page.getByTestId('comment-input')).toBeFocused();
    await page.keyboard.type('Check this.');
    await page.getByTestId('comment-add').click();
    await expect(page.getByTestId('comment')).toContainText('Maya scrubs dishes.');

    const tip = await page.getByTestId('el-character').getAttribute('data-tip');
    expect(tip).toContain('Who is speaking');
    await page.getByTestId('el-character').hover();
    await page.waitForTimeout(900);
    const shown = await page.getByTestId('el-character').evaluate((e) => getComputedStyle(e, '::after').visibility);
    expect(shown).toBe('visible');
  });

  test('cards expand, highlight the current scene and have a menu', async ({ page }) => {
    await projectWithTwoScenes(page, 'Cards Detail');
    await page.locator('.el-action').last().click();
    await page.getByTestId('rail-cards').click();
    const cards = page.getByTestId('card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(1)).toHaveAttribute('data-active', 'true');
    await expect(cards.nth(0)).not.toHaveAttribute('data-active', 'true');
    await cards.nth(0).getByTestId('card-expand').click();
    await expect(cards.nth(0)).toContainText('Shoes, Arjun.');
    await cards.nth(0).getByTestId('card-menu').click();
    await page.getByRole('menuitem', { name: 'Duplicate Card' }).click();
    await expect(page.getByTestId('card')).toHaveCount(3);
    await page.getByTestId('card').nth(1).getByTestId('card-menu').click();
    await page.getByRole('menuitem', { name: 'Remove Card' }).click();
    await expect(page.getByTestId('card')).toHaveCount(2);
    await page.getByTestId('card').nth(0).getByTestId('card-menu').click();
    await page.getByRole('menuitem', { name: 'Focus on card' }).click();
    await expect(page.getByTestId('filter-bar')).toContainText('Scene: INT. KITCHEN - DAY');
    await expect(page.locator('.el-scene:not(.el-hidden)')).toHaveCount(1);
    await page.getByTestId('cards-pad').click();
    await expect(page.locator('.pm-pad')).toBeVisible();
  });
});
