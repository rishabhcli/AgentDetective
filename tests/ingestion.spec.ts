import { expect, test } from '@playwright/test';
import { collectPageErrors, openCase } from './helpers.js';

test.beforeEach(async ({ request, page }) => {
  await request.post('http://127.0.0.1:8787/api/demo/reset');
  await openCase(page);
});

test('any file is preserved first and returns an honest in-app receipt', async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await page.route(/\/api\/cases\/[^/]+\/evidence$/u, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.continue();
  });

  await page.getByRole('button', { name: 'Add evidence' }).click();
  const intake = page.getByRole('dialog', { name: 'Add evidence' });
  await intake.locator('input[type="file"]').setInputFiles({
    name: 'recovered-device.evd',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from([0, 255, 17, 34, 51, 68]),
  });
  await expect(intake.getByLabel('Evidence title')).toHaveValue('recovered-device');
  await expect(intake.getByLabel('Source label')).toHaveValue(
    'Direct upload · recovered-device.evd',
  );
  await expect(intake.getByLabel('Artifact type')).toHaveValue('other');
  await intake.getByRole('button', { name: 'Preserve evidence' }).click();

  const notice = page.getByRole('region', {
    name: 'Evidence processing notification',
  });
  await expect(notice.getByRole('heading', { name: 'Processing evidence' })).toBeVisible();
  await expect(notice.getByRole('heading', { name: 'Original preserved' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(notice.getByText('EV-U011')).toBeVisible();
  await expect(
    notice.getByText('The file format is not currently interpretable.'),
  ).toBeVisible();
  await expect(notice.getByText('Choose one answer')).toHaveCount(0);

  await notice.getByRole('button', { name: 'Inspect source' }).click();
  await expect(page.getByRole('dialog', { name: /Inspect/ })).toContainText(
    'recovered-device.evd',
  );
  expect(errors).toEqual([]);
});

test('a hard metadata conflict surfaces MCQ choices and gates the custom field', async ({
  page,
  request,
}) => {
  const errors = collectPageErrors(page);
  await page.getByRole('button', { name: 'Add evidence' }).click();
  const intake = page.getByRole('dialog', { name: 'Add evidence' });
  await intake.locator('input[type="file"]').setInputFiles({
    name: 'door-controller.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Controller: east door accepted credential C17.'),
  });
  await intake.getByLabel('Artifact type').selectOption('audio');
  await intake.getByRole('button', { name: 'Preserve evidence' }).click();

  const notice = page.getByRole('region', {
    name: 'Evidence processing notification',
  });
  await expect(
    notice.getByText(
      'This document file was submitted as audio. Which classification should guide later extraction?',
    ),
  ).toBeVisible({ timeout: 30_000 });
  await expect(notice.getByText('Choose one answer')).toBeVisible();
  await expect(notice.getByLabel('Describe the classification context')).toHaveCount(0);

  await page.reload();
  await expect(
    notice.getByText(
      'This document file was submitted as audio. Which classification should guide later extraction?',
    ),
  ).toBeVisible();
  await expect(
    notice.getByRole('button', { name: 'Dismiss evidence notification' }),
  ).toHaveCount(0);

  await notice.getByLabel(/Something else/).check();
  const custom = notice.getByLabel('Describe the classification context');
  await expect(custom).toBeVisible();
  await custom.fill('This was an audio-system export rendered as a text diagnostic.');
  await notice.getByRole('button', { name: 'Record answer and continue' }).click();
  await expect(notice.getByText('Answer recorded')).toBeVisible();

  const persisted = (await (
    await request.get('http://127.0.0.1:8787/api/cases/case-badge-17')
  ).json()) as {
    state: {
      clarifications: Array<{
        status: string;
        selectedChoiceId: string;
        customAnswer: string | null;
      }>;
    };
  };
  expect(persisted.state.clarifications[0]).toMatchObject({
    status: 'answered',
    selectedChoiceId: 'custom',
    customAnswer: 'This was an audio-system export rendered as a text diagnostic.',
  });
  expect(errors).toEqual([]);
});
