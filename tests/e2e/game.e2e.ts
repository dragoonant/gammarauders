import { chromium, expect, test, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SAVE_KEY = 'wasteland-behemoths-save';

async function startGame(page: Page, opts: { seed?: string; opponents?: string } = {}) {
  await page.goto('/');
  await page.selectOption('select[name=opponents]', opts.opponents ?? '1');
  await page.selectOption('select[name=speed]', 'fast');
  await page.fill('input[name=seed]', opts.seed ?? '1234');
  await page.click('#new-game');
  await page.waitForSelector('#board .tile');
  await page.waitForSelector('[data-act=end-turn]:not([disabled])');
}

/** Flags words a broken render leaves behind (KB gotchas: page sweep). */
async function textSweep(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b/);
}

async function readEnvelope(page: Page) {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), SAVE_KEY);
}

test('plays a turn with no console errors and no broken text', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await startGame(page);
  await textSweep(page);
  await page.locator('.tile.reach').first().click();
  await page.click('[data-act=end-turn]');
  await expect(page.locator('.status')).toContainText('Round 2', { timeout: 60_000 });
  await page.waitForSelector('[data-act=end-turn]:not([disabled])', { timeout: 60_000 });
  await textSweep(page);
  await page.click('[data-act=rules]');
  await expect(page.locator('.dialog.rules')).toContainText('How to play');
  expect(errors).toEqual([]);
});

test('rule 24: a long press never selects text on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startGame(page);
  expect(await page.evaluate(() => getComputedStyle(document.body).userSelect)).toBe('none');
  await page.locator('.status').click({ clickCount: 3 });
  expect(await page.evaluate(() => String(getSelection()))).toBe('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('rule 25: a tap on a Behemoth reaches the hex behind it', async ({ page }) => {
  await startGame(page);
  const env = await readEnvelope(page);
  const enemy = env.snapshot.players[1];
  const key = `${enemy.pos.q},${enemy.pos.r}`;
  const box = await page.locator('.token[data-pid="1"] .body').boundingBox();
  if (!box) throw new Error('no enemy token');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-key]')?.getAttribute('data-key'), [cx, cy]);
  expect(hit).toBe(key);
  await page.mouse.click(cx, cy);
  await expect(page.locator('#inspector')).toContainText(enemy.beast);
  await expect(page.locator(`.tile[data-key="${key}"]`)).toHaveClass(/inspected/);
});

test('rule 22: autosave, close the browser, Continue to the same spot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-profile-'));
  const port = Number(process.env.PW_PORT ?? 4317);
  const url = `http://localhost:${port}/`;
  let ctx = await chromium.launchPersistentContext(dir);
  let page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(url);
  await page.selectOption('select[name=speed]', 'fast');
  await page.fill('input[name=seed]', '99');
  await page.click('#new-game');
  await page.waitForSelector('[data-act=end-turn]:not([disabled])');
  await page.locator('.tile.reach').first().click();
  await page.click('[data-act=end-turn]');
  await expect(page.locator('.status')).toContainText('Round 2', { timeout: 60_000 });
  await page.waitForSelector('[data-act=end-turn]:not([disabled])', { timeout: 60_000 });
  const before = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), SAVE_KEY);
  const logLines = await page.locator('.log div').count();
  expect(before.actions.length).toBeGreaterThan(2);
  await ctx.close();

  ctx = await chromium.launchPersistentContext(dir);
  page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(url);
  const box = page.locator('.save-box');
  await expect(box).toContainText(`round ${before.snapshot.round}`);
  await expect(box).toContainText('your turn');
  await page.click('[data-act=continue]');
  await page.waitForSelector('[data-act=end-turn]:not([disabled])');
  await expect(page.locator('.status')).toContainText(`Round ${before.snapshot.round}`);
  expect(await page.locator('.log div').count()).toBe(logLines);
  const after = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), SAVE_KEY);
  expect(after.actions.length).toBe(before.actions.length);
  expect(JSON.stringify(after.snapshot.players[0].hand)).toBe(JSON.stringify(before.snapshot.players[0].hand));

  // New game asks once more before replacing the save.
  await page.click('[data-act=menu]');
  await page.click('#new-game');
  await expect(page.locator('#replace-warn')).toBeVisible();
  await expect(page.locator('#new-game')).toHaveText('Replace and start');
  await ctx.close();
});

test('rule 22: damaged, finished and refused saves are never silent', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((k) => localStorage.setItem(k, '{not json'), SAVE_KEY);
  await page.reload();
  await expect(page.locator('.save-box.bad')).toContainText('unreadable');
  await page.click('[data-act=discard-save]');
  await expect(page.locator('.save-box')).toHaveCount(0);
  expect(await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY)).toBeNull();

  // A finished game clears its save instead of offering Continue.
  await startGame(page);
  await page.evaluate((k) => {
    const env = JSON.parse(localStorage.getItem(k)!);
    env.snapshot.winner = 0;
    localStorage.setItem(k, JSON.stringify(env));
  }, SAVE_KEY);
  await page.goto('/');
  await expect(page.locator('[data-act=continue]')).toHaveCount(0);
  expect(await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY)).toBeNull();
});

test('rule 22: a browser that refuses storage shows a line in the game', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error('QuotaExceededError');
    };
  });
  await startGame(page);
  await expect(page.locator('.toast')).toContainText('not storing saves');
});
