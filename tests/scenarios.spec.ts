import { expect, test } from '@playwright/test';
import { collectPageErrors, openCase, openCaseActions } from './helpers.js';

test.beforeEach(async ({ request, page }) => {
  await request.post('http://127.0.0.1:8787/api/demo/reset');
  await openCase(page);
  await openCaseActions(page);
  await page.getByRole('button', { name: 'Demo scenarios' }).click();
  await expect(page.getByRole('dialog', { name: 'Demo scenarios' })).toBeVisible();
});

test('lists every scenario with the question it answers and the runtime it exercises', async ({
  page,
}) => {
  const drawer = page.getByRole('dialog', { name: 'Demo scenarios' });
  const cards = drawer.locator('.scenario-card');
  await expect(cards).toHaveCount(5);

  await expect(drawer.getByText('Identity stays a distribution')).toBeVisible();
  await expect(drawer.getByText('One artifact moves the whole board')).toBeVisible();
  await expect(drawer.getByText('Two model families attack the case')).toBeVisible();
  await expect(drawer.getByText('A photograph is not a fact')).toBeVisible();
  await expect(drawer.getByText('A conversation is not evidence yet')).toBeVisible();

  // Each card states what it proves and how it will do it.
  await expect(cards.first().locator('.scenario-proves')).not.toBeEmpty();
  await expect(cards.first().locator('.scenario-steps li')).toHaveCount(3);
  await expect(cards.first().locator('.scenario-runtime')).toContainText('LangGraph');
});

test('scenario availability is read from live runtime state', async ({ page, request }) => {
  const health = await (await request.get('http://127.0.0.1:8787/api/health')).json();
  const active: Record<string, boolean> = Object.fromEntries(
    (health.integrations as Array<{ id: string; active: boolean }>).map((item) => [
      item.id,
      item.active,
    ]),
  );

  const drawer = page.getByRole('dialog', { name: 'Demo scenarios' });
  const providerCards = [
    { title: 'Two model families attack the case', provider: 'openrouter' },
    { title: 'A photograph is not a fact', provider: 'fireworks' },
    { title: 'A conversation is not evidence yet', provider: 'elevenlabs' },
  ];

  for (const { title, provider } of providerCards) {
    const card = drawer.locator('.scenario-card').filter({ hasText: title });
    const runButton = card.getByRole('button');
    if (active[provider]) {
      await expect(card.locator('.scenario-availability.is-ready')).toBeVisible();
      await expect(runButton).toBeEnabled();
    } else {
      // An adapter that is not live must disable its scenario rather than fail
      // partway through a demonstration.
      await expect(card.locator('.scenario-availability.is-unavailable')).toBeVisible();
      await expect(runButton).toBeDisabled();
    }
  }
});

test('the identity scenario runs the real investigation and reports its trace', async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  const drawer = page.getByRole('dialog', { name: 'Demo scenarios' });
  const card = drawer.locator('.scenario-card').filter({ hasText: 'Identity stays' });

  await card.getByRole('button', { name: /Run identity investigation/ }).click();

  // The trace is whatever the API reported, including the retrieval method.
  const audit = drawer.locator('.scenario-audit li');
  await expect(audit.first()).toBeVisible({ timeout: 30_000 });
  await expect(drawer.locator('.scenario-audit')).toContainText(/packet|observations/i);

  // Re-running is refused because the case already records the investigation.
  await expect(card.locator('.scenario-availability.is-already-run')).toBeVisible();
  await expect(card.getByRole('button')).toBeDisabled();

  expect(errors).toEqual([]);
});

test('the identity scenario updates the pinned investigative question', async ({
  page,
}) => {
  const drawer = page.getByRole('dialog', { name: 'Demo scenarios' });
  await drawer
    .locator('.scenario-card')
    .filter({ hasText: 'Identity stays' })
    .getByRole('button', { name: /Run identity investigation/ })
    .click();

  await expect(
    page.locator('.freeform-question').filter({ hasText: 'Who is “J”' }),
  ).toContainText('Jordan Lee is the leading binding at 83%');
});

test('the cascade scenario introduces Evidence 143 and opens the change trace', async ({
  page,
}) => {
  const drawer = page.getByRole('dialog', { name: 'Demo scenarios' });
  await drawer
    .locator('.scenario-card')
    .filter({ hasText: 'One artifact moves the whole board' })
    .getByRole('button', { name: /Introduce Evidence 143/ })
    .click();

  const changes = page.getByRole('dialog', { name: 'What changed' });
  await expect(changes).toBeVisible({ timeout: 30_000 });
  await expect(
    changes.getByText('Evidence 143 changed the leading reconstruction').first(),
  ).toBeVisible();
});

test('staged scenarios open the real control surface rather than a mock', async ({
  page,
}) => {
  const drawer = page.getByRole('dialog', { name: 'Demo scenarios' });
  const visual = drawer
    .locator('.scenario-card')
    .filter({ hasText: 'A photograph is not' });

  test.skip(
    !(await visual.getByRole('button').isEnabled()),
    'Fireworks is not live in this runtime.',
  );

  await visual.getByRole('button', { name: /Open evidence intake/ }).click();
  await expect(page.getByRole('dialog', { name: 'Add evidence' })).toBeVisible();
});

test('the adversarial scenario reveals the integrated agent conversation', async ({
  page,
}) => {
  const drawer = page.getByRole('dialog', { name: 'Demo scenarios' });
  const adversarial = drawer
    .locator('.scenario-card')
    .filter({ hasText: 'Two model families attack' });

  test.skip(
    !(await adversarial.getByRole('button').isEnabled()),
    'OpenRouter is not live in this runtime.',
  );

  await adversarial.getByRole('button', { name: /Open integrated agents/ }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByLabel('Case agent conversation')).toBeVisible();
  await expect(page.getByLabel('Ask THREAD')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Adversarial review' })).toHaveCount(0);
});
