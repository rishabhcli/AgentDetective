import { expect, type Page } from '@playwright/test';

/**
 * Console noise is treated as a failure. A forensic tool that logs warnings
 * while claiming provenance is not trustworthy, and React key/state warnings
 * are exactly the class of defect these flows should surface.
 */
const benignNotices = [
  // Motion logs this whenever the OS asks for reduced motion. It describes the
  // environment the test chose, not a defect in the interface.
  'Reduced Motion enabled on your device',
  // Chromium's software/headless WebGL backend can report a ReadPixels stall
  // while MetalFx captures its shared shader. This is a driver performance
  // notice, not an application warning or rendering failure.
  'GL Driver Message',
];

export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      const text = message.text();
      if (benignNotices.some((notice) => text.includes(notice))) return;
      errors.push(`console ${message.type()}: ${text}`);
    }
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const widths = await page.locator('body').evaluate((body) => ({
    scroll: body.scrollWidth,
    client: body.clientWidth,
  }));
  expect(widths.scroll).toBe(widths.client);
}

export async function openCase(page: Page): Promise<void> {
  await page.goto('/#case');
  await expect(page.locator('.canvas-floating-header h2')).toHaveText(
    'The Badge 17 discrepancy',
  );
}

export async function openCaseActions(page: Page): Promise<void> {
  const menu = page.locator('.workspace-action-menu');
  if (!(await menu.isVisible())) {
    await page.getByRole('button', { name: 'More case actions' }).click();
    await expect(menu).toBeVisible();
  }
}
