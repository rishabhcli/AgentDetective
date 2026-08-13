import { expect, test } from '@playwright/test';
import { collectPageErrors, expectNoHorizontalOverflow } from './helpers.js';

test.beforeEach(async ({ request }) => {
  await request.post('http://127.0.0.1:8787/api/demo/reset');
});

test('the animated landing page carries the user into the evidence canvas', async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'The Agentic Detective.' })).toBeVisible();
  await expect(page.locator('.landing-pinned-card')).toHaveCount(4);
  await expect(page.getByText('The badge opened the door.')).toBeAttached();
  await expect(
    page.getByRole('heading', { name: 'Who is the east-door entrant?' }).last(),
  ).toBeAttached();
  await expect(page.getByText('Source-linked', { exact: false })).toHaveCount(0);
  await expect(page.getByText('No guilt verdicts', { exact: false })).toHaveCount(0);
  await expect(page.getByText('LIVE SYNTHETIC MODEL', { exact: false })).toHaveCount(0);
  await expect(page.locator('.landing-orb-constellation button')).toHaveCount(7);

  const landingTheme = await page
    .locator('.landing-v2')
    .evaluate((element) => getComputedStyle(element).backgroundImage);

  await page.getByRole('button', { name: /Open Case 17/ }).click();
  await expect(page).toHaveURL(/#case$/);

  const guide = page.getByRole('dialog', { name: 'How this case works' });
  await expect(guide).toBeVisible();
  await expect(
    guide.getByRole('heading', { name: 'What are we trying to understand?' }),
  ).toBeVisible();
  await expect(
    guide.getByRole('button', { name: /Start with the question/ }),
  ).toHaveAttribute('aria-current', 'step');

  await guide.getByRole('button', { name: 'Continue' }).click();
  await expect(
    guide.getByRole('heading', {
      name: 'Cards are sources, candidates, and questions.',
    }),
  ).toBeVisible();
  await guide.getByRole('button', { name: 'Continue' }).click();
  await expect(
    guide.getByRole('heading', { name: 'Every string is an inspectable argument.' }),
  ).toBeVisible();
  await guide.getByRole('button', { name: 'Continue' }).click();
  await expect(
    guide.getByRole('heading', {
      name: 'Name the outcome. Watch the relevant evidence change.',
    }),
  ).toBeVisible();
  await guide.getByRole('button', { name: 'Open the evidence board' }).click();

  await expect(guide).toBeHidden();
  await expect(page.getByLabel(/Interactive evidence bulletin board/)).toBeVisible();
  await expect(page.locator('.freeform-card')).toHaveCount(12);
  const workspaceTheme = await page
    .locator('.app-shell')
    .evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(workspaceTheme).toBe(landingTheme);
  expect(errors).toEqual([]);
});

test('Ask THREAD enters a permanently integrated agent workspace', async ({
  page,
  request,
}) => {
  const health = (await (await request.get('http://127.0.0.1:8787/api/health')).json()) as {
    ok: boolean;
  };
  const ready = health.ok;

  await page.goto('/');
  const ask = page
    .getByRole('button', {
      name: ready ? 'Ask THREAD' : 'Case engine loading',
      exact: true,
    })
    .first();

  if (!ready) {
    await expect(ask).toBeDisabled();
    return;
  }

  await ask.click();
  await expect(page).toHaveURL(/#case$/);
  const guide = page.getByRole('dialog', { name: 'How this case works' });
  await expect(guide).toBeVisible();
  await guide.getByRole('button', { name: 'Skip case guide' }).click();
  const conversation = page.getByLabel('Case agent conversation');
  await expect(conversation).toBeVisible();
  await expect(conversation.getByLabel('Ask THREAD')).toBeVisible();
  await expect(conversation.getByLabel('Ask THREAD')).toBeFocused();
  await expect(conversation.getByRole('button', { name: 'Send to THREAD' })).toBeEnabled();
});

test('a real anonymized investigation can be selected and inspected without demo substitution', async ({
  page,
  request,
}) => {
  await request.post('http://127.0.0.1:8787/api/cases/case-sponsor-prize-dispute/reset');
  await page.goto('/');

  const realCase = page.getByRole('button', { name: /The missing sponsor prize/ });
  await realCase.click();
  await expect(realCase).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Anonymized real case · user-authorized')).toBeVisible();
  await expect(page.getByText(/That record has never surfaced/)).toBeVisible();

  await page.getByRole('button', { name: /Open the prize dispute/ }).click();
  await expect(page).toHaveURL(/#case=case-sponsor-prize-dispute$/);
  await page.getByRole('button', { name: 'Skip case guide' }).click();

  await expect(
    page.getByLabel(/Interactive evidence bulletin board with locked evidence cards/),
  ).toBeVisible();
  const sponsorPost = page.locator('.freeform-card').filter({
    hasText: 'Sponsor event post and photographs',
  });
  await expect(sponsorPost).toContainText('REDACTED REAL SOURCE');
  await expect(sponsorPost.getByText('OFFICIAL PUBLIC POST')).toBeAttached();
  await sponsorPost.hover();
  await expect(sponsorPost.getByText('IN THIS SOURCE')).toBeVisible();
  await expect(sponsorPost.getByText('WHY IT MATTERS')).toBeVisible();

  const conversation = page.getByLabel('Case agent conversation');
  const importedMission = conversation.locator('.mission-plan-card');
  await importedMission.scrollIntoViewIfNeeded();
  await expect(importedMission.getByText(/^completed$/i)).toBeVisible();
  await expect(
    importedMission.getByText('Tried to disprove the insider-routing account'),
  ).toBeVisible();
});

test('primary landing and workspace copy never collapses below a readable size', async ({
  page,
}) => {
  async function undersizedText(selector: string) {
    return page.locator(selector).evaluateAll((elements) =>
      elements.flatMap((root) =>
        Array.from(root.querySelectorAll<HTMLElement>('*')).flatMap((element) => {
          const ownText = Array.from(element.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent ?? '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          if (
            !ownText ||
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            Number(style.opacity) < 0.05 ||
            rect.width < 1 ||
            rect.height < 1 ||
            Number.parseFloat(style.fontSize) >= 12
          ) {
            return [];
          }
          return [`${ownText} (${style.fontSize})`];
        }),
      ),
    );
  }

  await page.goto('/');
  expect(await undersizedText('.landing-v2')).toEqual([]);

  await page.goto('/#case');
  expect(
    await undersizedText('.workspace-orb, .evidence-canvas, .agent-workspace'),
  ).toEqual([]);
});

test('the right side shows one honest Thinking Orb state per bounded agent', async ({
  page,
}) => {
  await page.goto('/#case');
  const agents = page.getByLabel('Seven case agents');
  await expect(agents.getByRole('button')).toHaveCount(7);
  await expect(
    page.getByText('Searches the case file and records every source it checked.'),
  ).toBeVisible();

  await page
    .getByRole('button', { name: /Run ledger/ })
    .first()
    .click();
  await expect(page.getByRole('dialog', { name: 'Run ledger' })).toBeVisible();
});

test('the landing experience is animated, complete, and overflow-free on a phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'The Agentic Detective.' })).toBeVisible();
  await expect(page.locator('.landing-pinned-card')).toHaveCount(4);
  await expectNoHorizontalOverflow(page);
});
