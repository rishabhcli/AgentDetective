import { expect, test } from '@playwright/test';
import type {
  AgentMission,
  AgentRun,
  CasePacket,
  CaseResearchSession,
  CaseState,
} from '@thread/domain';
import { collectPageErrors } from './helpers.js';

const question = 'Which identity lead is strongest, and what remains unproven?';

function fixtureResult(state: CaseState) {
  const now = new Date().toISOString();
  const packet: CasePacket = {
    id: 'PACKET-RESEARCH-E2E',
    caseId: state.metadata.id,
    question,
    retrievalMethod: 'atlas-rank-fusion',
    exactMatchIds: ['O-041-ACCESS'],
    semanticMatchIds: ['O-114-ALIAS'],
    graphNeighborIds: ['E-JORDAN', 'E-C17'],
    previousAttemptIds: [],
    evidenceIds: ['EV-041', 'EV-114'],
    observationIds: ['O-041-ACCESS', 'O-114-ALIAS'],
    retrievalHits: [
      {
        observationId: 'O-041-ACCESS',
        evidenceId: 'EV-041',
        rank: 1,
        score: 0.032,
        matchedBy: ['lexical', 'semantic'],
      },
      {
        observationId: 'O-114-ALIAS',
        evidenceId: 'EV-114',
        rank: 2,
        score: 0.028,
        matchedBy: ['semantic'],
      },
    ],
    strategy: {
      entityExpansion: true,
      temporalFilter: true,
      keywordSearch: true,
      semanticSearch: true,
      graphDepth: 2,
    },
    createdAt: now,
  };
  const run: AgentRun = {
    id: 'RUN-RESEARCH-E2E',
    caseId: state.metadata.id,
    trigger: `Case research: ${question}`,
    status: 'completed',
    affectedIds: ['EV-041', 'EV-114', 'O-041-ACCESS', 'O-114-ALIAS'],
    packetId: packet.id,
    checkpointThreadId: `${state.metadata.id}:RUN-RESEARCH-E2E`,
    checkpointId: 'checkpoint-e2e',
    steps: [
      'INGESTOR',
      'RESOLVER',
      'CHRONOLOGIST',
      'LINKER',
      'HYPOTHESIS ENGINE',
      'FALSIFIER',
      'INVESTIGATOR',
    ].map((agent, index) => ({
      id: `STEP-${index}`,
      agent: agent as AgentRun['steps'][number]['agent'],
      status: agent === 'INGESTOR' ? ('skipped' as const) : ('completed' as const),
      detail: 'Completed a bounded, source-linked transform.',
      inputIds: packet.observationIds,
      outputIds: agent === 'INGESTOR' ? [] : packet.observationIds,
      provider:
        agent === 'HYPOTHESIS ENGINE' || agent === 'FALSIFIER'
          ? ('openrouter' as const)
          : ('deterministic' as const),
      model: null,
      durationMs: 4,
    })),
    startedAt: now,
    completedAt: now,
  };
  const session: CaseResearchSession = {
    id: 'RESEARCH-E2E',
    caseId: state.metadata.id,
    question,
    scope: 'case',
    answer:
      'Jordan Lee is the strongest current binding for “J,” but the access event identifies Badge C17 rather than the person carrying it. The identity-to-entry step remains unproven.',
    answerStatus: 'lead-only',
    confidence: 0.71,
    findings: [
      {
        id: 'FINDING-E2E-1',
        label: 'Jordan leads the unresolved reference',
        detail:
          'The contact alias and shared context make Jordan the strongest candidate without converting the candidate link into identity fact.',
        status: 'lead',
        confidence: 0.83,
        sourceIds: ['EV-114', 'O-114-ALIAS'],
        surfaceCheckIds: ['SURFACE-E2E-EVIDENCE'],
      },
      {
        id: 'FINDING-E2E-2',
        label: 'Strongest challenge',
        detail:
          'The controller proves a credential event; it does not identify the entrant in Camera 4.',
        status: 'disputed',
        confidence: 0.68,
        sourceIds: ['EV-041', 'O-041-ACCESS'],
        surfaceCheckIds: ['SURFACE-E2E-EVIDENCE'],
      },
    ],
    surfaceChecks: [
      {
        id: 'SURFACE-E2E-MEMORY',
        label: 'Case memory',
        surface: 'case-memory',
        status: 'checked-empty',
        detail: 'No prior matching attempt was available.',
        locator: null,
        sourceId: null,
      },
      {
        id: 'SURFACE-E2E-EVIDENCE',
        label: 'Atlas hybrid evidence search',
        surface: 'case-evidence',
        status: 'found',
        detail: 'Exact and semantic retrieval returned two source artifacts.',
        locator: null,
        sourceId: 'EV-041',
      },
    ],
    negativeFindings: [
      {
        id: 'NEGATIVE-E2E',
        label: 'Entrant identity not established',
        detail: 'No preserved source directly binds a named person to the camera entrant.',
        surfaceCheckIds: ['SURFACE-E2E-EVIDENCE'],
      },
    ],
    corrections: [],
    nextQuestions: ['Who had custody of Badge C17 immediately before 21:08?'],
    limitations: [
      'This run searched the preserved case file only; connected accounts were not inspected.',
    ],
    provider: 'openrouter',
    model: 'test/hypothesis + test/falsifier',
    packetId: packet.id,
    runId: run.id,
    createdAt: now,
    completedAt: now,
  };
  const mission: AgentMission = {
    id: 'MISSION-RESEARCH-E2E',
    caseId: state.metadata.id,
    instruction: question,
    objective: question,
    scope: 'case',
    status: 'completed',
    initiatedBy: 'investigator',
    steps: [
      {
        id: 'MISSION-RESEARCH-E2E-S1',
        capability: 'recover-context',
        label: 'Recover the case state',
        detail: 'Recovered the current case revision and prior attempts.',
        status: 'completed',
        inputIds: [],
        outputIds: ['AN-J'],
        startedAt: now,
        completedAt: now,
      },
      {
        id: 'MISSION-RESEARCH-E2E-S2',
        capability: 'rank-evidence',
        label: 'Build the smallest useful packet',
        detail: 'Rank fusion returned two artifacts and two observations.',
        status: 'completed',
        inputIds: [],
        outputIds: [packet.id],
        startedAt: now,
        completedAt: now,
      },
      {
        id: 'MISSION-RESEARCH-E2E-S3',
        capability: 'challenge-account',
        label: 'Challenge the lead',
        detail: 'The credential-to-person gap survived the challenge.',
        status: 'completed',
        inputIds: packet.observationIds,
        outputIds: ['NEGATIVE-E2E'],
        startedAt: now,
        completedAt: now,
      },
      {
        id: 'MISSION-RESEARCH-E2E-S4',
        capability: 'persist-run',
        label: 'Preserve the result',
        detail: 'Mission, packet, source trail, and run were persisted together.',
        status: 'completed',
        inputIds: [session.id],
        outputIds: [run.id],
        startedAt: now,
        completedAt: now,
      },
    ],
    summary: session.answer,
    resultSessionId: session.id,
    runId: run.id,
    affectedIds: run.affectedIds,
    reviewReason: null,
    createdAt: now,
    startedAt: now,
    completedAt: now,
  };
  const nextState: CaseState = structuredClone(state);
  nextState.casePackets.unshift(packet);
  nextState.agentRuns.unshift(run);
  nextState.researchSessions.unshift(session);
  nextState.missions.unshift(mission);
  return {
    state: nextState,
    packet,
    run,
    session,
    mission,
    auditSteps: ['Case packet assembled.', 'Run persisted.'],
  };
}

test('the integrated research console returns the answer, search trail, negative space, and inspectable sources', async ({
  page,
  request,
}) => {
  const errors = collectPageErrors(page);
  const reset = await request.post('http://127.0.0.1:8787/api/demo/reset');
  const initial = ((await reset.json()) as { state: CaseState }).state;
  const result = fixtureResult(initial);

  await page.route('**/api/cases/case-badge-17/missions/stream', async (route) => {
    const lines = [
      {
        type: 'progress',
        progress: {
          id: 'retrieval',
          label: 'Case packet assembled',
          detail: 'Two sources and two relationship neighbors.',
          status: 'completed',
        },
      },
      { type: 'complete', result },
    ];
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`,
    });
  });

  await page.goto('/#case');
  const console = page.getByLabel('Case agent conversation');
  await expect(console.getByRole('button', { name: /Case file/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await console.getByLabel('Ask THREAD').fill(question);
  await console.getByRole('button', { name: 'Send to THREAD' }).click();

  await expect(
    console.getByText('Jordan Lee is the strongest current binding'),
  ).toBeVisible();
  await expect(console.getByText('What survived')).toBeVisible();
  await expect(console.getByText('Source trail', { exact: true })).toBeVisible();
  await expect(console.getByText('Checked, not established')).toBeVisible();
  await expect(console.getByText('Entrant identity not established')).toBeVisible();
  await expect(console.getByText('71%')).toBeVisible();
  const missionPlan = console.locator('.mission-plan-card');
  await expect(missionPlan.getByText(/^completed$/i)).toBeVisible();
  await expect(missionPlan.getByText('Challenge the lead')).toBeVisible();

  await console.getByRole('button', { name: 'EV-041' }).click();
  const inspector = page.getByRole('dialog', { name: /Inspect/ });
  await expect(inspector.getByText('East door access record')).toBeVisible();
  await inspector.getByRole('button', { name: 'Close inspector' }).click();
  expect(errors).toEqual([]);
});

test('connected research is visibly read-only and never presented as preserved evidence', async ({
  page,
  request,
}) => {
  const health = (await (await request.get('http://127.0.0.1:8787/api/health')).json()) as {
    integrations: Array<{ id: string; active: boolean }>;
  };
  const connectedReady = health.integrations.some(
    (integration) => integration.id === 'aside' && integration.active,
  );

  await page.goto('/#case');
  const console = page.getByLabel('Case agent conversation');
  const connected = console.getByRole('button', { name: /Connected/ });
  await expect(connected).toBeEnabled({ enabled: connectedReady });
  if (connectedReady) {
    await connected.click();
    await expect(connected).toHaveAttribute('aria-pressed', 'true');
    await expect(console.getByText(/Never sends, posts, reacts, or edits/)).toBeVisible();
    await expect(console.getByText(/Observe-only/)).toBeVisible();
  }
});
