import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { collectPageErrors, openCaseActions } from './helpers.js';

const API = 'http://127.0.0.1:8787';

/**
 * The claim under test is the one the whole engine rests on: an investigator
 * can open a case with nothing in it, put ordinary files into it, and get a
 * real investigation back. No fixture participates in any of this.
 */

const GATE_LOG = [
  'Camera 4: Dana Reyes entered Warehouse A on 2026-08-04T21:06:00Z.',
  'Camera 4: Vehicle 7VXK220 was parked at Warehouse A on 2026-08-04T21:04:00Z.',
].join('\n');

const PIER_LOG = 'Camera 9: Dana Reyes was seen at Pier 48 on 2026-08-04T21:06:30Z.';

async function openNewCase(page: Page, title: string) {
  await openCaseActions(page);
  await page.getByRole('button', { name: 'Open a new case' }).click();
  const drawer = page.getByRole('dialog', { name: 'Open a new case' });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel('Case title').fill(title);
  await drawer.getByRole('button', { name: 'Open case' }).click();
  await expect(drawer).toBeHidden();
  await page.getByRole('button', { name: 'Skip case guide' }).click();
  await expect(page.locator('.canvas-floating-header h2')).toHaveText(title);
}

async function preserve(page: Page, fileName: string, content: string) {
  await page.getByRole('button', { name: 'Add evidence' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add evidence' });
  await expect(drawer).toBeVisible();
  await drawer.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from(content),
  });
  await drawer.getByRole('button', { name: 'Preserve evidence' }).click();
  await expect(drawer).toBeHidden({ timeout: 30_000 });
  // The intake receipt is modal; dismissing it returns to the board.
  const notice = page.getByRole('dialog', { name: /Evidence/ });
  if (await notice.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
  }
}

/** Cases created by these specs are the investigator's own, so they are removed. */
async function deleteCasesTitled(request: APIRequestContext, prefix: string) {
  const listed = (await (await request.get(`${API}/api/cases`)).json()) as {
    cases: Array<{ id: string; title: string }>;
  };
  for (const item of listed.cases) {
    if (item.title.startsWith(prefix)) {
      await request.delete(`${API}/api/cases/${encodeURIComponent(item.id)}`);
    }
  }
}

test.beforeEach(async ({ request, page }) => {
  await request.post(`${API}/api/demo/reset`);
  await deleteCasesTitled(request, 'Spec ');
  await page.goto('/#case');
  await expect(page.locator('.canvas-floating-header h2')).toBeVisible();
});

test.afterEach(async ({ request }) => {
  await deleteCasesTitled(request, 'Spec ');
});

test('a new case opens with nothing derived in it', async ({ page, request }) => {
  const errors = collectPageErrors(page);
  await openNewCase(page, 'Spec empty case');

  const listed = (await (await request.get(`${API}/api/cases`)).json()) as {
    cases: Array<{ id: string; title: string }>;
  };
  const created = listed.cases.find((item) => item.title === 'Spec empty case');
  expect(created).toBeDefined();

  const state = (await (
    await request.get(`${API}/api/cases/${encodeURIComponent(created?.id ?? '')}`)
  ).json()) as { state: { entities: unknown[]; worldEdges: unknown[] } };
  expect(state.state.entities).toEqual([]);
  expect(state.state.worldEdges).toEqual([]);
  expect(errors).toEqual([]);
});

test('uploaded files alone produce participants, relationships and questions', async ({
  page,
  request,
}) => {
  const errors = collectPageErrors(page);
  await openNewCase(page, 'Spec derived case');
  await preserve(page, 'gate-log.txt', GATE_LOG);

  const listed = (await (await request.get(`${API}/api/cases`)).json()) as {
    cases: Array<{ id: string; title: string }>;
  };
  const created = listed.cases.find((item) => item.title === 'Spec derived case');
  const body = (await (
    await request.get(`${API}/api/cases/${encodeURIComponent(created?.id ?? '')}`)
  ).json()) as {
    state: {
      entities: Array<{ label: string }>;
      worldEdges: Array<{ assumptionIds: string[] }>;
      anomalies: unknown[];
    };
  };

  expect(body.state.entities.map((item) => item.label)).toEqual(
    expect.arrayContaining(['Dana Reyes', 'Warehouse A']),
  );
  expect(body.state.worldEdges.length).toBeGreaterThan(0);
  expect(body.state.anomalies.length).toBeGreaterThan(0);
  // Nothing is asserted without naming the leap it took.
  expect(body.state.worldEdges.every((edge) => edge.assumptionIds.length > 0)).toBe(true);
  expect(errors).toEqual([]);
});

test('two artifacts that disagree put the case into open contradiction', async ({
  page,
  request,
}) => {
  const errors = collectPageErrors(page);
  await openNewCase(page, 'Spec contradiction case');
  await preserve(page, 'gate-log.txt', GATE_LOG);
  await preserve(page, 'pier-log.txt', PIER_LOG);

  const listed = (await (await request.get(`${API}/api/cases`)).json()) as {
    cases: Array<{ id: string; title: string }>;
  };
  const created = listed.cases.find((item) => item.title === 'Spec contradiction case');
  const body = (await (
    await request.get(`${API}/api/cases/${encodeURIComponent(created?.id ?? '')}`)
  ).json()) as {
    state: {
      beliefs: Array<{ kind: string; status: string }>;
      reconstructions: Array<{ isLeading: boolean }>;
    };
  };

  const contradictions = body.state.beliefs.filter((item) => item.kind === 'contradiction');
  expect(contradictions.length).toBeGreaterThan(0);

  // Competing explanations are offered and none of them is selected as truth.
  const hypotheses = body.state.beliefs.filter((item) => item.kind === 'hypothesis');
  expect(hypotheses.length).toBeGreaterThanOrEqual(3);
  expect(hypotheses.every((item) => item.status === 'open')).toBe(true);

  expect(body.state.reconstructions.length).toBeGreaterThanOrEqual(2);
  expect(body.state.reconstructions.filter((item) => item.isLeading)).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('discrediting one source withdraws its footprint and leaves the other standing', async ({
  page,
  request,
}) => {
  const errors = collectPageErrors(page);
  await openNewCase(page, 'Spec two sources');
  await preserve(page, 'gate-log.txt', GATE_LOG);
  await preserve(page, 'pier-log.txt', PIER_LOG);

  const listed = (await (await request.get(`${API}/api/cases`)).json()) as {
    cases: Array<{ id: string; title: string }>;
  };
  const caseId = listed.cases.find((item) => item.title === 'Spec two sources')?.id ?? '';
  const before = (await (
    await request.get(`${API}/api/cases/${encodeURIComponent(caseId)}`)
  ).json()) as {
    state: {
      evidence: Array<{ id: string; fileName: string }>;
      assumptions: Array<{ id: string }>;
      worldEdges: Array<{ id: string; confidence: number; assumptionIds: string[] }>;
    };
  };

  // Each artifact carries its own reliability warrant.
  const discredited = before.state.evidence.find(
    (item) => item.fileName === 'gate-log.txt',
  );
  const warrant = `A-SOURCE-${discredited?.id ?? ''}`;
  expect(before.state.assumptions.some((item) => item.id === warrant)).toBe(true);

  const resting = before.state.worldEdges.filter((edge) =>
    edge.assumptionIds.includes(warrant),
  );
  const independent = before.state.worldEdges.filter(
    (edge) => !edge.assumptionIds.includes(warrant),
  );
  expect(resting.length).toBeGreaterThan(0);
  expect(independent.length).toBeGreaterThan(0);

  const cascade = await request.post(
    `${API}/api/cases/${encodeURIComponent(caseId)}/assumptions/${warrant}/challenge`,
    { data: {} },
  );
  expect(cascade.ok()).toBe(true);
  const after = (await cascade.json()) as {
    state: { worldEdges: Array<{ id: string; confidence: number; disputed: boolean }> };
  };

  for (const edge of resting) {
    const updated = after.state.worldEdges.find((item) => item.id === edge.id);
    expect(updated?.confidence).toBeLessThan(edge.confidence);
    expect(updated?.disputed).toBe(true);
  }
  // The other source's relationships are untouched: discrediting a witness is
  // not the same as discrediting the case.
  for (const edge of independent) {
    const updated = after.state.worldEdges.find((item) => item.id === edge.id);
    expect(updated?.confidence).toBe(edge.confidence);
  }
  expect(errors).toEqual([]);
});

test('an investigator can invalidate a derived assumption and see the cascade', async ({
  page,
  request,
}) => {
  const errors = collectPageErrors(page);
  await openNewCase(page, 'Spec cascade case');
  await preserve(page, 'gate-log.txt', GATE_LOG);

  const listed = (await (await request.get(`${API}/api/cases`)).json()) as {
    cases: Array<{ id: string; title: string }>;
  };
  const caseId = listed.cases.find((item) => item.title === 'Spec cascade case')?.id ?? '';
  const before = (await (
    await request.get(`${API}/api/cases/${encodeURIComponent(caseId)}`)
  ).json()) as { state: { worldEdges: Array<{ confidence: number; disputed: boolean }> } };

  const cascade = await request.post(
    `${API}/api/cases/${encodeURIComponent(caseId)}/assumptions/A-LEAP-TESTIMONY/challenge`,
    { data: {} },
  );
  expect(cascade.ok()).toBe(true);
  const after = (await cascade.json()) as {
    revision: { changes: Array<{ direction: string }> } | null;
    state: { worldEdges: Array<{ confidence: number; disputed: boolean }> };
  };

  expect(after.revision).not.toBeNull();
  expect(after.revision?.changes.some((change) => change.direction === 'invalidated')).toBe(
    true,
  );
  // Everything that rested on the warrant lost the share of confidence it carried.
  const weakened = after.state.worldEdges.filter((edge) => edge.disputed);
  expect(weakened.length).toBeGreaterThan(0);
  expect(after.state.worldEdges.length).toBe(before.state.worldEdges.length);
  expect(errors).toEqual([]);
});
