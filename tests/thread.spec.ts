import { expect, test } from '@playwright/test';
import { collectPageErrors, openCaseActions } from './helpers.js';

test.beforeEach(async ({ request }) => {
  await request.post('http://127.0.0.1:8787/api/demo/reset');
});

test('critical board, provenance, investigation, cascade, upload, and reset flow', async ({
  page,
  request,
}) => {
  const errors = collectPageErrors(page);
  const health = (await (await request.get('http://127.0.0.1:8787/api/health')).json()) as {
    engineLabel: string;
  };
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The Agentic Detective.' })).toBeVisible();
  await page.getByRole('button', { name: /Open Case 17/ }).click();
  await page.getByRole('button', { name: 'Skip case guide' }).click();

  await expect(page.getByLabel(/Interactive evidence bulletin board/)).toBeVisible();
  await expect(page.getByText('Case engine ready')).toBeVisible();
  await expect(page.getByLabel('Seven case agents').getByRole('button')).toHaveCount(7);

  await page
    .getByRole('button', { name: 'Inspect has access to relationship' })
    .first()
    .click();
  const inspector = page.getByRole('dialog', { name: /Inspect/ });
  await expect(inspector.getByText('EVERY STRING IS AN ARGUMENT')).toBeVisible();
  await expect(inspector.getByText('FOR', { exact: true })).toBeVisible();
  await expect(inspector.getByText('AGAINST', { exact: true })).toBeVisible();
  await inspector.getByRole('button', { name: 'Close inspector' }).click();

  const identityCard = page.locator('.freeform-question').filter({ hasText: 'Who is “J”' });
  await identityCard.getByRole('button', { name: 'Investigate' }).click();
  await expect(identityCard).toContainText('Jordan Lee is the leading binding at 83%', {
    timeout: 30_000,
  });
  await expect(identityCard).toContainText('INVESTIGATED');

  await openCaseActions(page);
  await page.getByRole('button', { name: 'Introduce Evidence 143' }).click();
  const changes = page.getByRole('dialog', { name: 'What changed' });
  await expect(changes).toBeVisible({ timeout: 30_000 });
  await expect(
    changes.getByText('Evidence 143 changed the leading reconstruction').first(),
  ).toBeVisible();
  await expect(changes.getByText('81%', { exact: true })).toBeVisible();
  await expect(changes.getByText('48%', { exact: true })).toBeVisible();
  await expect(changes.getByText('73%', { exact: true })).toBeVisible();
  await changes.getByRole('button', { name: 'Close change history' }).click();

  await expect(page.locator('.freeform-card').filter({ hasText: 'EV-143' })).toBeVisible();
  await expect(
    page.locator('.freeform-reconstruction').filter({
      hasText: 'Another person used C17',
    }),
  ).toContainText('73% coverage');

  await openCaseActions(page);
  await page.getByRole('button', { name: 'Open engine status' }).click();
  const status = page.getByRole('dialog', { name: 'Engine status' });
  await expect(status.getByText('No simulated integrations')).toBeVisible();
  await expect(status.getByText(health.engineLabel)).toBeVisible();
  await status.getByRole('button', { name: 'Close engine status' }).click();

  await page.getByRole('button', { name: 'Add evidence' }).click();
  const upload = page.getByRole('dialog', { name: 'Add evidence' });
  await upload.locator('input[type="file"]').setInputFiles({
    name: 'field-note.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Riley: maybe someone left the package there around nine.'),
  });
  await upload.getByLabel('Evidence title').fill('Field note 22');
  await upload.getByLabel('Source label').fill('Notebook scan transcription');
  await upload.getByLabel('Artifact type').selectOption('document');
  await upload.getByRole('button', { name: 'Preserve evidence' }).click();
  await expect(upload).toBeHidden();
  await expect(
    page.locator('.freeform-card').filter({ hasText: 'Field note 22' }),
  ).toBeVisible();

  await openCaseActions(page);
  await page.getByRole('button', { name: /Reset sample/ }).click();
  await expect(page.locator('.workspace-revision')).toContainText('REV 01');
  await expect(
    page.locator('.freeform-card').filter({ hasText: 'Field note 22' }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('narrow viewport exposes a smooth board-to-agents flow without body overflow', async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#case');
  await expect(page.getByLabel(/Interactive evidence bulletin board/)).toBeVisible();
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await expect
    .poll(() => page.locator('#case-workspace').evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(100);
  await expect(page.getByLabel('Case agent conversation')).toBeVisible();
  await expect(page.getByLabel('Ask THREAD')).toBeVisible();
  const widths = await page.locator('body').evaluate((body) => ({
    scroll: body.scrollWidth,
    client: body.clientWidth,
  }));
  expect(widths.scroll).toBe(widths.client);
  expect(errors).toEqual([]);
});

test('the evidence board is locked by default and persists an unlocked freeform layout', async ({
  page,
}) => {
  await page.goto('/#case');
  const board = page.getByLabel(/Interactive evidence bulletin board/);
  await expect(board).toHaveAttribute('aria-label', /with locked evidence cards/);

  const node = page.locator('.react-flow__node[data-id="EV-014"]');
  const initialTransform = await node.evaluate(
    (element) => (element as HTMLElement).style.transform,
  );
  await page.getByRole('button', { name: 'Unlock board' }).click();
  await expect(board).toHaveAttribute(
    'aria-label',
    /with movable and resizable evidence cards/,
  );

  const handle = node.locator('.board-drag-handle');
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 18);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 105, box!.y + 82, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => node.evaluate((element) => (element as HTMLElement).style.transform))
    .not.toBe(initialTransform);
  const movedTransform = await node.evaluate(
    (element) => (element as HTMLElement).style.transform,
  );
  await expect
    .poll(() =>
      page.evaluate(() => window.localStorage.getItem('thread-board-layout:case-badge-17')),
    )
    .not.toBeNull();

  await page.getByRole('button', { name: 'Lock board' }).click();
  await expect(board).toHaveAttribute('aria-label', /with locked evidence cards/);
  await page.reload();
  await expect
    .poll(() =>
      page
        .locator('.react-flow__node[data-id="EV-014"]')
        .evaluate((element) => (element as HTMLElement).style.transform),
    )
    .toBe(movedTransform);
});
