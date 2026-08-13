import { expect, test, type Page } from '@playwright/test';
import { collectPageErrors, openCase, openCaseActions } from './helpers.js';

test.beforeEach(async ({ request, page }) => {
  await request.post('http://127.0.0.1:8787/api/demo/reset');
  await openCase(page);
});

async function openDeduction(page: Page) {
  await openCaseActions(page);
  await page.getByRole('button', { name: 'Deduction' }).click();
  const drawer = page.getByRole('dialog', { name: 'Deduction chains' });
  await expect(drawer).toBeVisible();
  return drawer;
}

test('a chain separates what was observed from what was merely attested', async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  const drawer = await openDeduction(page);

  await expect(drawer.locator('.rung-observed').first()).toBeVisible();
  await expect(drawer.locator('.rung-attested').first()).toBeVisible();

  // The labels are the whole point: seeing and being told are not the same.
  await expect(drawer.locator('.rung-observed').first()).toContainText('OBSERVED');
  await expect(drawer.locator('.rung-attested').first()).toContainText('ATTESTED');

  expect(errors).toEqual([]);
});

test('a chain names its leap and ends in a held conclusion', async ({ page }) => {
  const drawer = await openDeduction(page);

  await expect(drawer.locator('.rung-assumed').first()).toContainText('ASSUMED');

  const rungs = drawer.locator('.ladder .rung');
  await expect(rungs.last()).toHaveClass(/rung-concluded/);
  await expect(rungs.last()).toContainText('THEREFORE');

  await expect(drawer.getByText('THIS COLLAPSES IF')).toBeVisible();
});

test('the limiting step is called out explicitly', async ({ page }) => {
  const drawer = await openDeduction(page);
  const limiting = drawer.locator('.rung.is-limiting');

  await expect(limiting).toHaveCount(1);
  await expect(limiting).toContainText('LIMITING STEP');
});

test('hedged testimony keeps its hedges visible in the chain', async ({ page }) => {
  const drawer = await openDeduction(page);
  await expect(
    drawer.locator('.rung-attested').filter({ hasText: 'hedged with' }).first(),
  ).toBeVisible();
});

test('a rung source opens the provenance inspector', async ({ page }) => {
  const drawer = await openDeduction(page);
  await drawer.locator('.rung-sources button').first().click();

  await expect(page.getByRole('dialog', { name: /Inspect/ })).toBeVisible();
});

test('selecting another chain re-renders the ladder', async ({ page }) => {
  const drawer = await openDeduction(page);
  const question = await drawer.locator('.chain-question').innerText();

  await drawer.locator('.chain-picker button').nth(1).click();
  await expect(drawer.locator('.chain-question')).not.toHaveText(question);
  await expect(drawer.locator('.ladder .rung').last()).toHaveClass(/rung-concluded/);
});

test('keystones rank what would collapse the most of the case', async ({ page }) => {
  const drawer = await openDeduction(page);
  await drawer.getByRole('tab', { name: /Keystones/ }).click();

  const cards = drawer.locator('.keystone-card');
  await expect(cards.first()).toBeVisible();
  await expect(cards.first()).toContainText(/relationships/);
  await expect(cards.first()).toContainText(/beliefs depend on it/);
});

test('silences report the evidence that is absent', async ({ page }) => {
  const drawer = await openDeduction(page);
  await drawer.getByRole('tab', { name: /Silences/ }).click();

  const cards = drawer.locator('.silence-card');
  await expect(cards.first()).toBeVisible();
  await expect(drawer.getByText(/Absence is a finding/)).toBeVisible();
  await expect(cards.first()).toContainText(/Exposure \d+%/);
});

test('an unresolved identity is reported as a spread rather than a name', async ({
  page,
}) => {
  const drawer = await openDeduction(page);
  await drawer.getByRole('tab', { name: /Silences/ }).click();

  await expect(
    drawer.locator('.silence-card').filter({ hasText: 'never been resolved' }).first(),
  ).toContainText('distribution and not a name');
});

test('counter-evidence turns the invalidated assumption into the keystone that failed', async ({
  page,
}) => {
  // Reasoning and interface have to agree: A-19 is what Evidence 143 destroys.
  await openCaseActions(page);
  await page.getByRole('button', { name: 'Introduce Evidence 143' }).click();
  await expect(page.getByRole('dialog', { name: 'What changed' })).toBeVisible({
    timeout: 30_000,
  });
  await page.keyboard.press('Escape');

  const drawer = await openDeduction(page);
  await drawer.getByRole('tab', { name: /Keystones/ }).click();

  const failed = drawer.locator('.keystone-card').filter({ hasText: 'A-19' });
  await expect(failed).toHaveClass(/is-invalid/);
  await expect(failed.locator('.keystone-status')).toHaveText('invalid');
});
