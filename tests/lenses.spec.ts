import { expect, test } from '@playwright/test';
import { collectPageErrors, openCase } from './helpers.js';

test.beforeEach(async ({ request, page }) => {
  await request.post('http://127.0.0.1:8787/api/demo/reset');
  await openCase(page);
});

test('the default workspace is one tactile Freeform-style evidence canvas', async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  const board = page.getByLabel(/Interactive evidence bulletin board/);
  await expect(board).toBeVisible();
  await expect(page.locator('.lens-rail')).toHaveCount(0);
  await expect(page.locator('.runtime-ribbon')).toHaveCount(0);
  await expect(page.locator('.tools-menu')).toHaveCount(0);
  await expect(page.locator('.freeform-card')).toHaveCount(12);
  await expect(page.locator('.evidence-thread')).not.toHaveCount(0);
  expect(errors).toEqual([]);
});

test('unlocked evidence cards move freely without mutating the case state', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Unlock board' }).click();
  const card = page
    .locator('.react-flow__node')
    .filter({ hasText: 'East door access record' });
  const before = await card.boundingBox();
  expect(before).not.toBeNull();
  const handle = await card.locator('.board-drag-handle').boundingBox();
  expect(handle).not.toBeNull();
  await page.mouse.move((handle?.x ?? 0) + 40, (handle?.y ?? 0) + 10);
  await page.mouse.down();
  await page.mouse.move((handle?.x ?? 0) + 170, (handle?.y ?? 0) + 75, {
    steps: 8,
  });
  await page.mouse.up();
  const after = await card.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeGreaterThan(20);
  await expect(page.locator('.workspace-revision')).toContainText('REV 01');
});

test('selecting a card exposes real resize handles without opening a popout', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Unlock board' }).click();
  const card = page.locator('.react-flow__node').filter({ hasText: 'Camera 4 east-door' });
  await card.click();
  await expect(card.locator('.board-resize-handle')).toHaveCount(4);
  await expect(page.getByRole('dialog', { name: /Inspect/ })).toHaveCount(0);
});

test('every visible string carries a semantic accessible label', async ({ page }) => {
  const strings = page.locator('.react-flow__edge');
  const count = await strings.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    await expect(strings.nth(index)).toHaveAttribute('aria-label', /.+/);
  }
  await expect(page.locator('.evidence-thread.is-disputed')).not.toHaveCount(0);
});

test('a qualified world string opens its full provenance argument', async ({ page }) => {
  const edge = page
    .getByRole('button', {
      name: 'Inspect has access to relationship',
    })
    .first();
  await expect(edge).toBeVisible();
  await edge.click();
  const inspector = page.getByRole('dialog', { name: /Inspect/ });
  await expect(inspector.getByText('EVERY STRING IS AN ARGUMENT')).toBeVisible();
  await expect(inspector.getByText('FOR', { exact: true })).toBeVisible();
  await expect(inspector.getByText('AGAINST', { exact: true })).toBeVisible();
});

test('an evidence card opens the immutable artifact instead of asserting a fact', async ({
  page,
}) => {
  const card = page.locator('.freeform-card').filter({ hasText: 'Key handoff email' });
  await card.getByRole('button', { name: 'Inspect source' }).click();
  const inspector = page.getByRole('dialog', { name: /Inspect/ });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByText('CHAIN OF CUSTODY')).toBeVisible();
  await expect(inspector.getByText('PRESERVED SOURCE CONTENT')).toBeVisible();
});

test('investigating the pinned question changes its persisted board card', async ({
  page,
}) => {
  const question = page.locator('.freeform-question').filter({ hasText: 'Who is “J”' });
  await question.getByRole('button', { name: 'Investigate' }).click();
  await expect(question).toContainText('Jordan Lee is the leading binding at 83%', {
    timeout: 30_000,
  });
  await expect(question).toContainText('INVESTIGATED');
});

test('the evidence canvas and case-agent conversation are siblings in one workspace', async ({
  page,
}) => {
  await expect(page.getByLabel(/Interactive evidence bulletin board/)).toBeVisible();
  await expect(page.getByLabel('Case agent conversation')).toBeVisible();
  await expect(page.getByLabel('Seven case agents').getByRole('button')).toHaveCount(7);
});
