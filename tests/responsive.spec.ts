import { expect, test } from '@playwright/test';
import {
  collectPageErrors,
  expectNoHorizontalOverflow,
  openCase,
  openCaseActions,
} from './helpers.js';

const viewports = [
  { name: 'wide desktop', width: 1680, height: 1000 },
  { name: 'laptop', width: 1440, height: 900 },
  { name: 'small laptop', width: 1280, height: 860 },
  { name: 'narrow desktop', width: 1100, height: 820 },
  { name: 'tablet landscape', width: 900, height: 800 },
  { name: 'tablet portrait', width: 760, height: 900 },
  { name: 'large phone', width: 610, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];

test.beforeEach(async ({ request }) => {
  await request.post('http://127.0.0.1:8787/api/demo/reset');
});

for (const viewport of viewports) {
  test(`${viewport.name} (${viewport.width}px) keeps the board and agents reachable`, async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openCase(page);

    await expect(page.getByLabel(/Interactive evidence bulletin board/)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    if (viewport.width <= 820) {
      await page.getByRole('button', { name: 'Agents', exact: true }).click();
      await expect
        .poll(() =>
          page.locator('#case-workspace').evaluate((element) => element.scrollLeft),
        )
        .toBeGreaterThan(100);
      await expect(page.getByLabel('Case agent conversation')).toBeVisible();
      await page.getByRole('button', { name: 'Board', exact: true }).click();
    } else {
      await expect(page.getByLabel('Case agent conversation')).toBeVisible();
    }
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
}

test('a drawer remains inside the phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCase(page);

  await openCaseActions(page);
  await page.getByRole('button', { name: 'What changed?' }).click();
  const drawer = page.getByRole('dialog', { name: 'What changed' });
  await expect(drawer).toBeVisible();
  await expect
    .poll(async () => (await drawer.boundingBox())?.x ?? -1)
    .toBeGreaterThanOrEqual(0);
  await expect
    .poll(async () => (await drawer.boundingBox())?.width ?? 0)
    .toBeLessThanOrEqual(390);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expectNoHorizontalOverflow(page);
});

test('the canvas remains operable when reduced motion is requested', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openCase(page);
  await expect(page.locator('.freeform-card')).toHaveCount(12);
  await openCaseActions(page);
  await page.getByRole('button', { name: 'Open engine status' }).click();
  await expect(page.getByRole('dialog', { name: 'Engine status' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('the skip link is the first tab stop and reaches the evidence workspace', async ({
  page,
}) => {
  await openCase(page);
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: 'Skip to case workspace' });
  await expect(skipLink).toBeFocused();
  await skipLink.click();
  await expect(page.locator('#case-workspace')).toBeVisible();
});

test('a board card can be focused and opened entirely from the keyboard', async ({
  page,
}) => {
  await openCase(page);
  const node = page
    .locator('.react-flow__node')
    .filter({ hasText: 'East door access record' });
  await node.focus();
  await expect(node).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  // React Flow selects on Enter. The source button is the explicit provenance path.
  await node.getByRole('button', { name: 'Inspect source' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: /Inspect/ })).toBeVisible();
});

test('every control on the default view exposes an accessible name', async ({ page }) => {
  await openCase(page);
  const unnamed = await page.evaluate(() => {
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    return [...document.querySelectorAll('button, a, input, select, textarea')]
      .filter(isVisible)
      .filter((element) => {
        const label =
          element.getAttribute('aria-label') ??
          element.getAttribute('title') ??
          element.textContent?.trim() ??
          '';
        return label.length === 0;
      })
      .map((element) => `${element.tagName}.${element.className}`);
  });
  expect(unnamed).toEqual([]);
});
