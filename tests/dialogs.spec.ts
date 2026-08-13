import { expect, test, type Locator, type Page } from '@playwright/test';
import { openCase, openCaseActions } from './helpers.js';

interface DialogCase {
  name: string;
  dialog: string;
  trigger: (page: Page) => Locator | Promise<Locator>;
  closeLabel: string;
  returnFocus: (page: Page) => Locator;
}

async function menuTrigger(page: Page, name: string): Promise<Locator> {
  await openCaseActions(page);
  return page.getByRole('button', { name });
}

const dialogCases: DialogCase[] = [
  {
    name: 'What changed',
    dialog: 'What changed',
    closeLabel: 'Close change history',
    trigger: (page) => page.locator('.workspace-revision'),
    returnFocus: (page) => page.locator('.workspace-revision'),
  },
  {
    name: 'Engine status',
    dialog: 'Engine status',
    closeLabel: 'Close engine status',
    trigger: (page) => menuTrigger(page, 'Open engine status'),
    returnFocus: (page) => page.getByRole('button', { name: 'More case actions' }),
  },
  {
    name: 'Add evidence',
    dialog: 'Add evidence',
    closeLabel: 'Close evidence intake',
    trigger: (page) => page.getByRole('button', { name: 'Add evidence' }),
    returnFocus: (page) => page.getByRole('button', { name: 'Add evidence' }),
  },
  {
    name: 'Run ledger',
    dialog: 'Run ledger',
    closeLabel: 'Close run ledger',
    trigger: (page) => page.getByRole('button', { name: /Run ledger/ }).first(),
    returnFocus: (page) => page.getByRole('button', { name: /Run ledger/ }).first(),
  },
  {
    name: 'Witness interview',
    dialog: 'Witness interview',
    closeLabel: 'Close witness interview',
    trigger: (page) => page.getByRole('button', { name: 'Interview witness' }),
    returnFocus: (page) => page.getByRole('button', { name: 'Interview witness' }),
  },
  {
    name: 'Demo scenarios',
    dialog: 'Demo scenarios',
    closeLabel: 'Close demo scenarios',
    trigger: (page) => menuTrigger(page, 'Demo scenarios'),
    returnFocus: (page) => page.getByRole('button', { name: 'More case actions' }),
  },
  {
    name: 'Deduction chains',
    dialog: 'Deduction chains',
    closeLabel: 'Close deduction chains',
    trigger: (page) => menuTrigger(page, 'Deduction'),
    returnFocus: (page) => page.getByRole('button', { name: 'More case actions' }),
  },
];

test.beforeEach(async ({ request, page }) => {
  await request.post('http://127.0.0.1:8787/api/demo/reset');
  await openCase(page);
});

for (const dialogCase of dialogCases) {
  test.describe(dialogCase.name, () => {
    test('announces itself as a modal dialog and focuses its close control', async ({
      page,
    }) => {
      const trigger = await dialogCase.trigger(page);
      test.skip(await trigger.isDisabled(), `${dialogCase.name} is unavailable.`);
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: dialogCase.dialog });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute('aria-modal', 'true');
      await expect(
        dialog.getByRole('button', { name: dialogCase.closeLabel }),
      ).toBeFocused();
    });

    test('closes on Escape and returns focus to its stable control', async ({ page }) => {
      const trigger = await dialogCase.trigger(page);
      test.skip(await trigger.isDisabled(), `${dialogCase.name} is unavailable.`);
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: dialogCase.dialog });
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(dialogCase.returnFocus(page)).toBeFocused();
    });

    test('closes from its own close control', async ({ page }) => {
      const trigger = await dialogCase.trigger(page);
      test.skip(await trigger.isDisabled(), `${dialogCase.name} is unavailable.`);
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: dialogCase.dialog });
      await dialog.getByRole('button', { name: dialogCase.closeLabel }).click();
      await expect(dialog).toBeHidden();
    });
  });
}

test('the provenance inspector obeys the same dialog contract', async ({ page }) => {
  await page
    .locator('.freeform-card')
    .filter({ hasText: 'East door access record' })
    .getByRole('button', { name: 'Inspect source' })
    .click();
  const inspector = page.getByRole('dialog', { name: /Inspect/ });
  await expect(inspector).toBeVisible();
  await expect(inspector).toHaveAttribute('aria-modal', 'true');
  await expect(inspector.getByRole('button', { name: 'Close inspector' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(inspector).toBeHidden();
});

test('the agent conversation is integrated rather than presented as a modal', async ({
  page,
}) => {
  await expect(page.getByLabel('Case agent conversation')).toBeVisible();
  await expect(
    page.getByLabel('Case agent conversation').getByRole('textbox'),
  ).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Adversarial review' })).toHaveCount(0);
});
