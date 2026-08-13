import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import {
  applyCounterEvidence,
  challengeAssumption,
  createEmptyCase,
  inferEvidenceKind,
  ingestLocalEvidence,
  investigateAnomaly,
  isMaterialEvidenceKindConflict,
  runInferencePass,
  sampleCaseId,
  type AgentName,
  type AgentMission,
  type AgentMissionStep,
  type AgentRun,
  type CasePacket,
  type CaseResearchSession,
  type CaseState,
  type EvidenceClarification,
  type EvidenceIngestionReceipt,
  type EvidenceKind,
  type HealthStatus,
  type InformationCredibility,
  type IntegrationStatus,
  type ResearchScope,
  type StandingOrder,
  validateCaseIntegrity,
} from '@thread/domain';
import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import multer from 'multer';
import { z } from 'zod';
import { extractUpload } from './extraction.js';
import { buildResearchSession, type ReviewBundle } from './case-research.js';
import {
  AsideResearchAdapter,
  type ConnectedResearchAdapter,
  type ConnectedResearchOutput,
} from './connected-research.js';
import { AgentOrchestrator } from './orchestrator.js';
import { ProviderHub } from './providers.js';
import { isBundledCase, JsonCaseStore, type CaseStore } from './store.js';

const evidenceKinds: EvidenceKind[] = [
  'message',
  'email',
  'image',
  'video',
  'audio',
  'document',
  'access-log',
  'calendar',
  'location',
  'other',
];

const uploadFields = z.object({
  title: z.string().trim().min(1).max(120),
  sourceLabel: z.string().trim().min(1).max(120),
  kind: z.enum(evidenceKinds as [EvidenceKind, ...EvidenceKind[]]),
  sourceReliability: z.enum(['A', 'B', 'C', 'D', 'E', 'F']).default('F'),
  informationCredibility: z.coerce.number().int().min(1).max(6).default(6),
});

const reviewFields = z.object({
  question: z.string().trim().min(8).max(500),
});

const researchFields = reviewFields.extend({
  scope: z.enum(['case', 'connected']).default('case'),
});

const challengeFields = z.object({
  evidenceId: z.string().trim().min(1).max(80).optional(),
});

const newCaseFields = z.object({
  title: z.string().trim().min(3).max(120),
  subtitle: z.string().trim().min(1).max(240).optional(),
  classification: z.string().trim().min(1).max(80).optional(),
  location: z.string().trim().min(1).max(120).optional(),
});

/** A readable, filesystem-safe case id derived from the title. */
function uniqueCaseId(title: string, taken: ReadonlySet<string>): string {
  const base =
    title
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 48) || 'case';
  let candidate = `case-${base}`;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `case-${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

const missionFields = z.object({
  instruction: z.string().trim().min(8).max(1_200),
  scope: z.enum(['case', 'connected']).default('case'),
});

const clarificationAnswerFields = z.object({
  choiceId: z.string().trim().min(1).max(80),
  customAnswer: z.string().trim().max(500).optional(),
});

function createClassificationClarification(input: {
  caseId: string;
  evidenceId: string;
  submittedKind: EvidenceKind;
  detectedKind: EvidenceKind;
  createdAt: string;
}): EvidenceClarification {
  return {
    id: `CL-${input.evidenceId}-KIND`,
    caseId: input.caseId,
    evidenceId: input.evidenceId,
    kind: 'artifact-classification-conflict',
    question: `This ${input.detectedKind} file was submitted as ${input.submittedKind}. Which classification should guide later extraction?`,
    detail:
      'The original is already preserved and THREAD has continued. Your answer records interpretation context; it does not rewrite the source.',
    submittedKind: input.submittedKind,
    detectedKind: input.detectedKind,
    choices: [
      {
        id: 'use-detected',
        label: `Use ${input.detectedKind}`,
        description: 'Use the file container detected from its MIME type and extension.',
        recommended: true,
      },
      {
        id: 'keep-submitted',
        label: `Keep ${input.submittedKind}`,
        description:
          'Retain the category supplied with the upload as investigator context.',
        recommended: false,
      },
      {
        id: 'leave-unresolved',
        label: 'Leave unresolved',
        description: 'Keep both classifications visible until another adapter inspects it.',
        recommended: false,
      },
    ],
    allowCustomAnswer: true,
    status: 'open',
    selectedChoiceId: null,
    customAnswer: null,
    createdAt: input.createdAt,
    answeredAt: null,
  };
}

function fallbackProviderStatuses(environment: NodeJS.ProcessEnv): IntegrationStatus[] {
  return [
    {
      id: 'fireworks',
      label: 'Fireworks extraction',
      configured: Boolean(environment.FIREWORKS_API_KEY),
      active: false,
      detail: environment.FIREWORKS_API_KEY
        ? 'Credential configured; live verification has not run.'
        : 'No credential is configured.',
      state: environment.FIREWORKS_API_KEY ? 'degraded' : 'unconfigured',
      verifiedAt: null,
    },
    {
      id: 'openrouter',
      label: 'OpenRouter reasoning',
      configured: Boolean(environment.OPENROUTER_API_KEY),
      active: false,
      detail: environment.OPENROUTER_API_KEY
        ? 'Credential configured; live verification has not run.'
        : 'No credential is configured.',
      state: environment.OPENROUTER_API_KEY ? 'degraded' : 'unconfigured',
      verifiedAt: null,
    },
    {
      id: 'elevenlabs',
      label: 'ElevenLabs interview',
      configured: Boolean(
        environment.ELEVENLABS_API_KEY && environment.ELEVENLABS_AGENT_ID,
      ),
      active: false,
      detail:
        environment.ELEVENLABS_API_KEY && environment.ELEVENLABS_AGENT_ID
          ? 'Credential and agent configured; live verification has not run.'
          : 'An API key and agent ID are both required.',
      state:
        environment.ELEVENLABS_API_KEY && environment.ELEVENLABS_AGENT_ID
          ? 'degraded'
          : 'unconfigured',
      verifiedAt: null,
    },
  ];
}

async function integrationStatus(
  environment: NodeJS.ProcessEnv,
  store: CaseStore,
  providers: ProviderHub,
  connectedResearch: ConnectedResearchAdapter,
): Promise<HealthStatus> {
  const [diagnostics, cases] = await Promise.all([store.diagnostics(), store.listCases()]);
  const integrityReports = await Promise.all(
    cases.map(async (metadata) => {
      const state = await store.getCase(metadata.id);
      return state ? validateCaseIntegrity(state) : null;
    }),
  );
  const integrityIssues = integrityReports
    .filter((report): report is NonNullable<typeof report> => Boolean(report))
    .flatMap((report) => report.issues.filter((issue) => issue.severity === 'error'));
  const providerStatuses = providers.getStatuses();
  const connectedStatus = await connectedResearch.status();
  const mongo: IntegrationStatus = {
    id: 'mongodb',
    label: 'MongoDB Atlas Local',
    configured: Boolean(environment.MONGODB_URI),
    active: store.mode === 'mongodb',
    detail:
      store.mode === 'mongodb'
        ? 'Local replica-set persistence is live; ping, normalized collections, and indexes passed startup.'
        : 'MongoDB is not selected; an atomic local JSON store is active.',
    state: store.mode === 'mongodb' ? 'ready' : 'unconfigured',
    verifiedAt: new Date().toISOString(),
  };
  return {
    ok: integrityIssues.length === 0,
    storageMode: store.mode,
    engineLabel:
      store.mode === 'mongodb' ? 'Atlas Local evidence engine' : 'Local evidence engine',
    integrations: [
      mongo,
      ...(providerStatuses.length > 0
        ? providerStatuses
        : fallbackProviderStatuses(environment)),
      connectedStatus,
    ],
    capabilities: [
      ...diagnostics.capabilities,
      {
        id: 'data-integrity',
        label: 'Case data integrity',
        active: integrityIssues.length === 0,
        detail:
          integrityIssues.length === 0
            ? `${integrityReports.filter(Boolean).length} case snapshots passed lineage and synthetic-data checks.`
            : `${integrityIssues.length} blocking lineage issues were found.`,
      },
    ],
    dataIntegrity: {
      ok: integrityIssues.length === 0,
      checkedCases: integrityReports.filter(Boolean).length,
      issueCount: integrityIssues.length,
    },
  };
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'evidence.bin';
}

function uniqueIds(...groups: string[][]): string[] {
  return [...new Set(groups.flat())];
}

const previewMimeTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

async function attachRun(input: {
  state: CaseState;
  orchestrator: AgentOrchestrator;
  trigger: string;
  affectedIds: string[];
  packetId?: string | null;
  selectedAgents?: AgentName[];
  providerDetails?: Parameters<AgentOrchestrator['run']>[0]['providerDetails'];
}) {
  const run = await input.orchestrator.run({
    caseId: input.state.metadata.id,
    trigger: input.trigger,
    affectedIds: uniqueIds(input.affectedIds),
    ...(input.packetId === undefined ? {} : { packetId: input.packetId }),
    ...(input.selectedAgents ? { selectedAgents: input.selectedAgents } : {}),
    ...(input.providerDetails ? { providerDetails: input.providerDetails } : {}),
  });
  input.state.agentRuns.unshift(run);
  return run;
}

interface ResearchProgressEvent {
  id: 'context' | 'retrieval' | 'connected' | 'reasoning' | 'challenge' | 'checkpoint';
  label: string;
  detail: string;
  status: 'active' | 'completed';
}

interface ResearchExecution {
  state: CaseState;
  packet: CasePacket;
  run: AgentRun;
  session: CaseResearchSession;
  auditSteps: string[];
}

interface MissionExecution extends ResearchExecution {
  mission: AgentMission;
}

type ResearchProgressWriter = (event: ResearchProgressEvent) => void;

function missionIntent(instruction: string) {
  const normalized = instruction.toLocaleLowerCase();
  return {
    investigate:
      /\b(?:investigate|work|solve|trace|find|check|verify|resolve|follow)\b/u.test(
        normalized,
      ),
    watch: /\b(?:watch|monitor|keep checking|alert me|tell me when)\b/u.test(normalized),
    requestsExternalWrite:
      /\b(?:send|email|message|contact|post|publish|book|pay|delete|edit|submit)\b/u.test(
        normalized,
      ),
  };
}

const objectiveStopWords = new Set([
  'about',
  'after',
  'against',
  'also',
  'and',
  'before',
  'case',
  'check',
  'find',
  'from',
  'have',
  'into',
  'investigate',
  'mission',
  'most',
  'question',
  'show',
  'that',
  'the',
  'then',
  'this',
  'trace',
  'what',
  'when',
  'where',
  'which',
  'who',
  'with',
  'work',
]);

function objectiveTerms(value: string): string[] {
  return [
    ...new Set(
      value
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
        .split(/\s+/u)
        .filter((term) => term.length > 2 && !objectiveStopWords.has(term)),
    ),
  ];
}

function caseObjectText(state: CaseState, id: string): string {
  const artifact = state.evidence.find((item) => item.id === id);
  if (artifact)
    return `${artifact.id} ${artifact.title} ${artifact.sourceLabel} ${artifact.content ?? ''}`;
  const observation = state.observations.find((item) => item.id === id);
  if (observation) return `${observation.id} ${observation.text} ${observation.locator}`;
  const claim = state.claims.find((item) => item.id === id);
  if (claim) return `${claim.id} ${claim.proposition} ${claim.verbatim}`;
  const entity = state.entities.find((item) => item.id === id);
  if (entity)
    return `${entity.id} ${entity.label} ${entity.aliases.join(' ')} ${entity.description} ${Object.values(entity.properties).flat().join(' ')}`;
  const assumption = state.assumptions.find((item) => item.id === id);
  if (assumption) return `${assumption.id} ${assumption.label} ${assumption.detail}`;
  const reconstruction = state.reconstructions.find((item) => item.id === id);
  if (reconstruction)
    return `${reconstruction.id} ${reconstruction.title} ${reconstruction.summary}`;
  const reference = state.unresolvedReferences.find((item) => item.id === id);
  if (reference) return `${reference.id} ${reference.surfaceForm} ${reference.context}`;
  return id;
}

function selectObjectiveAnomaly(state: CaseState, instruction: string) {
  const open = state.anomalies.filter((item) => item.status === 'open');
  if (open.length === 0) return null;
  if (/\b(?:highest-value|highest value|top open question)\b/iu.test(instruction)) {
    return open
      .slice()
      .sort((a, b) => b.expectedInformationGain - a.expectedInformationGain)[0]!;
  }
  const terms = objectiveTerms(instruction);
  if (terms.length === 0) return null;
  const ranked = open
    .map((anomaly) => {
      const corpus = objectiveTerms(
        `${anomaly.id} ${anomaly.question} ${anomaly.detail} ${anomaly.relatedIds
          .map((id) => caseObjectText(state, id))
          .join(' ')}`,
      );
      const corpusTerms = new Set(corpus);
      const matchedTerms = terms.filter((term) => corpusTerms.has(term));
      return { anomaly, matchedTerms };
    })
    .filter((item) => item.matchedTerms.length > 0)
    .sort(
      (a, b) =>
        b.matchedTerms.length - a.matchedTerms.length ||
        b.anomaly.expectedInformationGain - a.anomaly.expectedInformationGain,
    );
  return ranked[0]?.anomaly ?? null;
}

function researchExecutionDetails(input: {
  state: CaseState;
  packet: CasePacket;
  review: ReviewBundle | null;
  connected: ConnectedResearchOutput | null;
}): NonNullable<Parameters<AgentOrchestrator['run']>[0]['providerDetails']> {
  const { state, packet, review, connected } = input;
  const packetEvidence = new Set(packet.evidenceIds);
  const packetObservations = new Set(packet.observationIds);
  const packetNeighbors = new Set(packet.graphNeighborIds);
  const references = state.unresolvedReferences.filter(
    (reference) =>
      reference.sourceEvidenceIds.some((id) => packetEvidence.has(id)) ||
      reference.candidateBindings.some(
        (candidate) => candidate.entityId && packetNeighbors.has(candidate.entityId),
      ),
  );
  const temporalObservations = state.observations.filter(
    (observation) => packetObservations.has(observation.id) && observation.interval,
  );
  const temporalConstraints = state.temporalConstraints.filter((constraint) =>
    constraint.sourceIds.some((id) => packetObservations.has(id)),
  );
  const relevantEdges = state.worldEdges.filter(
    (edge) =>
      packetNeighbors.has(edge.subjectId) ||
      packetNeighbors.has(edge.objectId) ||
      edge.sourceObservationIds.some((id) => packetObservations.has(id)) ||
      edge.sourceClaimIds.some((id) => packet.evidenceIds.includes(claimSource(state, id))),
  );
  const leading = state.reconstructions.find((item) => item.isLeading);
  const alternative = review
    ? state.reconstructions.find(
        (item) => item.id === review.falsifier.alternative_reconstruction_id,
      )
    : state.reconstructions
        .filter((item) => !item.isLeading)
        .sort((a, b) => b.coveragePercent - a.coveragePercent)[0];
  const disputedEdges = relevantEdges.filter((edge) => edge.disputed);
  const relatedQuestions = state.anomalies.filter(
    (anomaly) =>
      anomaly.status === 'open' &&
      anomaly.relatedIds.some(
        (id) =>
          packetEvidence.has(id) || packetNeighbors.has(id) || packetObservations.has(id),
      ),
  );

  return {
    RESOLVER: {
      provider: 'deterministic',
      model: null,
      detail:
        references.length > 0
          ? `Compared ${references.length} unresolved reference${references.length === 1 ? '' : 's'} against only the candidate signals present in ${packet.id}; no identity was hard-merged.`
          : `${packet.id} contained no unresolved reference with a source or candidate inside the retrieved orbit.`,
      inputIds: packet.observationIds,
      outputIds: references.map((item) => item.id),
    },
    CHRONOLOGIST: {
      provider: 'deterministic',
      model: null,
      detail: `Checked ${temporalObservations.length} source-bound interval${temporalObservations.length === 1 ? '' : 's'} and ${temporalConstraints.length} Allen constraint${temporalConstraints.length === 1 ? '' : 's'} in the packet.`,
      inputIds: temporalObservations.map((item) => item.id),
      outputIds: temporalConstraints.map((item) => item.id),
    },
    LINKER: {
      provider: 'deterministic',
      model: null,
      detail: `Expanded ${relevantEdges.length} provenance-bearing relationship${relevantEdges.length === 1 ? '' : 's'} from ${packet.graphNeighborIds.length} retrieved graph neighbors.`,
      inputIds: uniqueIds(packet.observationIds, packet.graphNeighborIds),
      outputIds: relevantEdges.map((item) => item.id),
    },
    'HYPOTHESIS ENGINE': {
      provider: review ? 'openrouter' : 'deterministic',
      model: review?.hypothesisModel ?? null,
      detail:
        review?.hypothesis.summary ??
        (leading
          ? `Recomputed the existing accounts from packet sources; ${leading.id} retains ${leading.coveragePercent}% weighted coverage.`
          : 'No reconstruction exists yet; the packet was retained without inventing one.'),
      inputIds: uniqueIds(packet.observationIds, packet.evidenceIds),
      outputIds: leading ? [leading.id] : [],
    },
    FALSIFIER: {
      provider: review ? 'openrouter' : 'deterministic',
      model: review?.falsifierModel ?? null,
      detail:
        review?.falsifier.strongest_counterargument ??
        `Tested the lead against ${disputedEdges.length} disputed relationship${disputedEdges.length === 1 ? '' : 's'} and ${alternative ? `alternative ${alternative.id}` : 'no stored alternative'}.`,
      inputIds: uniqueIds(
        leading ? [leading.id] : [],
        disputedEdges.map((item) => item.id),
      ),
      outputIds: uniqueIds(
        alternative ? [alternative.id] : [],
        disputedEdges.map((item) => item.id),
      ),
    },
    INVESTIGATOR: {
      provider: connected ? 'aside' : 'deterministic',
      model: connected?.model ?? null,
      detail:
        connected?.answer ??
        `Identified ${relatedQuestions.length} unresolved question${relatedQuestions.length === 1 ? '' : 's'} linked to this packet after preserving the retrieval and falsification trace.`,
      inputIds: [packet.id],
      outputIds: relatedQuestions.map((item) => item.id),
    },
  };
}

function claimSource(state: CaseState, claimId: string): string {
  return state.claims.find((claim) => claim.id === claimId)?.sourceEvidenceId ?? '';
}

function missionPlan(input: {
  id: string;
  scope: ResearchScope;
  instruction: string;
  createdAt: string;
}): AgentMissionStep[] {
  const intent = missionIntent(input.instruction);
  const step = (
    suffix: string,
    capability: AgentMissionStep['capability'],
    label: string,
    detail: string,
    status: AgentMissionStep['status'] = 'queued',
  ): AgentMissionStep => ({
    id: `${input.id}-${suffix}`,
    capability,
    label,
    detail,
    status,
    inputIds: [],
    outputIds: [],
    startedAt: null,
    completedAt: status === 'skipped' ? input.createdAt : null,
  });
  return [
    step(
      'S1',
      'recover-context',
      'Recover context',
      'Load prior attempts, corrections, and preserved source families.',
    ),
    step(
      'S2',
      'rank-evidence',
      'Retrieve evidence',
      'Rank exact text, semantic matches, and relationship neighbors for this objective.',
    ),
    step(
      'S3',
      'investigate-anomaly',
      'Resolve a matching gap',
      'Run a deterministic case transform only when an open question matches this objective.',
      intent.investigate ? 'queued' : 'skipped',
    ),
    step(
      'S4',
      'connected-research',
      'Search connected sources',
      'Use the configured Aside profile under its read-only runtime contract.',
      input.scope === 'connected' ? 'queued' : 'skipped',
    ),
    step(
      'S5',
      'challenge-account',
      'Challenge the lead',
      'Compare opposing evidence, alternatives, assumptions, and checked-empty surfaces.',
    ),
    step(
      'S6',
      'watch-for-change',
      'Watch new evidence',
      'Re-run a deterministic relevance check whenever new evidence is preserved.',
      intent.watch ? 'queued' : 'skipped',
    ),
    step(
      'S7',
      'persist-run',
      'Commit the trace',
      'Store the mission, source trail, negative findings, packet, and run ledger together.',
    ),
  ];
}

export interface AppOptions {
  store: CaseStore;
  environment?: NodeJS.ProcessEnv;
  uploadDirectory?: string;
  providers?: ProviderHub;
  orchestrator?: AgentOrchestrator;
  connectedResearch?: ConnectedResearchAdapter;
}

export function createApp({
  store,
  environment = process.env,
  uploadDirectory,
  providers = new ProviderHub(environment),
  orchestrator = new AgentOrchestrator({}),
  connectedResearch = new AsideResearchAdapter(environment),
}: AppOptions) {
  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  });
  const rawDirectory =
    uploadDirectory ??
    (store instanceof JsonCaseStore
      ? join(store.dataDirectory, 'uploads')
      : '.thread-data/uploads');

  async function executeResearch(
    state: CaseState,
    question: string,
    scope: ResearchScope,
    writeProgress: ResearchProgressWriter = () => undefined,
  ): Promise<ResearchExecution> {
    const startedAt = new Date().toISOString();
    const sessionId = `RESEARCH-${Date.now().toString(36).toUpperCase()}`;
    const progress: ResearchProgressEvent[] = [];
    const report = (event: ResearchProgressEvent) => {
      progress.push(event);
      writeProgress(event);
    };
    report({
      id: 'context',
      label: 'Recovered case context',
      detail: `${state.evidence.length} preserved artifacts, ${state.proceduralMemory.length} prior attempts, revision ${state.metadata.revision}.`,
      status: 'completed',
    });
    report({
      id: 'retrieval',
      label: 'Searching the case file',
      detail: 'Ranking exact text, semantic similarity, and relationship neighbors.',
      status: 'active',
    });
    const packet = await store.buildCasePacket(state, question);
    state.casePackets.unshift(packet);
    report({
      id: 'retrieval',
      label: 'Case packet assembled',
      detail: `${packet.observationIds.length} observations · ${packet.graphNeighborIds.length} neighbors · ${packet.previousAttemptIds.length} prior strategies.`,
      status: 'completed',
    });

    let review: ReviewBundle | null = null;
    let connected: ConnectedResearchOutput | null = null;
    let providerFailure: string | null = null;
    if (scope === 'connected') {
      report({
        id: 'connected',
        label: 'Sweeping connected sources',
        detail:
          'Aside is reading only relevant history, public pages, and already-authenticated surfaces. Write actions are blocked by the task contract.',
        status: 'active',
      });
      connected = await connectedResearch.research(state, packet);
      report({
        id: 'connected',
        label: 'Connected sweep complete',
        detail: `${connected.surfaces.length} surfaces returned ${connected.findings.length} findings and ${connected.negativeFindings.length} clean negatives.`,
        status: 'completed',
      });
    } else if (providers.isActive('openrouter')) {
      report({
        id: 'reasoning',
        label: 'Building the strongest account',
        detail: 'One model family is measuring explanatory coverage from the packet.',
        status: 'active',
      });
      try {
        review = await providers.adversarialReview(state, packet);
        const reconstructionIds = new Set(state.reconstructions.map((item) => item.id));
        const returnedIds = [
          review.hypothesis.leading_reconstruction_id,
          review.falsifier.alternative_reconstruction_id,
        ];
        if (returnedIds.some((id) => !reconstructionIds.has(id))) {
          throw new Error('A model selected a reconstruction outside the bounded case.');
        }
        report({
          id: 'reasoning',
          label: 'Leading account assembled',
          detail: `${review.hypothesisModel} returned a schema-validated, source-bounded synthesis.`,
          status: 'completed',
        });
        report({
          id: 'challenge',
          label: 'Strongest lead challenged',
          detail: `${review.falsifierModel} independently tested the alternative and stop condition.`,
          status: 'completed',
        });
      } catch (error) {
        providerFailure = error instanceof Error ? error.message : 'remote review failed';
        report({
          id: 'reasoning',
          label: 'Local synthesis took over',
          detail:
            'The remote review did not complete. THREAD continued with deterministic coverage, contradiction, and information-gain analysis.',
          status: 'completed',
        });
      }
    } else {
      report({
        id: 'reasoning',
        label: 'Local synthesis complete',
        detail:
          'Deterministic coverage, contradiction, and expected-information-gain analysis ran without a remote model.',
        status: 'completed',
      });
    }

    report({
      id: 'checkpoint',
      label: 'Preserving the run',
      detail:
        'Writing procedural memory, belief memory, checked surfaces, and the run ledger.',
      status: 'active',
    });
    const providerDetails = researchExecutionDetails({
      state,
      packet,
      review,
      connected,
    });
    const selectedAgents: AgentName[] = [
      'RESOLVER',
      'CHRONOLOGIST',
      'LINKER',
      'HYPOTHESIS ENGINE',
      'FALSIFIER',
      'INVESTIGATOR',
    ];
    const run = await attachRun({
      state,
      orchestrator,
      trigger: `${scope === 'connected' ? 'Connected read-only research' : 'Case research'}: ${question}`,
      affectedIds: uniqueIds(
        packet.evidenceIds,
        packet.observationIds,
        packet.graphNeighborIds,
      ),
      packetId: packet.id,
      selectedAgents,
      providerDetails,
    });
    const completedAt = new Date().toISOString();
    const session = buildResearchSession({
      state,
      packet,
      scope,
      sessionId,
      runId: run.id,
      startedAt,
      completedAt,
      review,
      connected,
    });
    if (providerFailure) {
      session.limitations.unshift(
        `Remote review failed and the deterministic engine continued: ${providerFailure}`,
      );
    }
    state.researchSessions.unshift(session);
    state.beliefMemory.unshift({
      id: `MB-${session.id}`,
      caseId: state.metadata.id,
      kind: 'belief',
      subjectId: session.id,
      summary: session.answer,
      sourceIds: uniqueIds(packet.evidenceIds, packet.observationIds),
      confidence: session.confidence,
      revision: state.metadata.revision,
      updatedAt: completedAt,
    });
    const completedAudit = progress
      .filter((event) => event.status === 'completed')
      .map((event) => `${event.label}: ${event.detail}`);
    state.proceduralMemory.unshift({
      id: `ATTEMPT-${session.id}`,
      caseId: state.metadata.id,
      anomalyId: session.id,
      question,
      strategy: packet.strategy,
      returnedEvidenceIds: packet.evidenceIds,
      usefulEvidenceIds: uniqueIds(
        packet.evidenceIds,
        session.findings.flatMap((finding) => finding.sourceIds),
      ).filter((id) => state.evidence.some((item) => item.id === id)),
      result: session.answer,
      utilityScore: session.confidence,
      auditSteps: completedAudit,
      createdAt: completedAt,
    });
    await store.saveCase(state);
    const checkpoint = {
      id: 'checkpoint' as const,
      label: 'Run persisted',
      detail: `${run.id} · ${run.checkpointId ? `checkpoint ${run.checkpointId}` : 'local ledger'} · ${session.surfaceChecks.length} surfaces recorded.`,
      status: 'completed' as const,
    };
    report(checkpoint);
    return {
      state,
      packet,
      run,
      session,
      auditSteps: [
        ...completedAudit,
        `${checkpoint.label}: ${checkpoint.detail}`,
        'Research output was stored as procedural and belief memory, not promoted to evidence or a world fact.',
      ],
    };
  }

  async function executeMission(
    inputState: CaseState,
    instruction: string,
    scope: ResearchScope,
    writeProgress: ResearchProgressWriter = () => undefined,
  ): Promise<MissionExecution> {
    let state = structuredClone(inputState);
    const createdAt = new Date().toISOString();
    const missionId = `MISSION-${Date.now().toString(36).toUpperCase()}`;
    const intent = missionIntent(instruction);
    const mission: AgentMission = {
      id: missionId,
      caseId: state.metadata.id,
      instruction,
      objective: instruction.replace(/\s+/gu, ' ').trim(),
      scope,
      status: 'running',
      initiatedBy: 'investigator',
      steps: missionPlan({ id: missionId, scope, instruction, createdAt }),
      summary: null,
      resultSessionId: null,
      runId: null,
      affectedIds: [],
      reviewReason: null,
      createdAt,
      startedAt: createdAt,
      completedAt: null,
    };
    state.missions.unshift(mission);
    await store.saveCase(state);

    const activeMission = () => {
      const current = state.missions.find((item) => item.id === missionId);
      if (!current) throw new Error(`Mission ${missionId} was lost from the case state.`);
      return current;
    };
    const updateStep = (
      capability: AgentMissionStep['capability'],
      status: AgentMissionStep['status'],
      detail: string,
      inputIds: string[] = [],
      outputIds: string[] = [],
    ) => {
      const step = activeMission().steps.find((item) => item.capability === capability);
      if (!step) return;
      const now = new Date().toISOString();
      if (status === 'running' && !step.startedAt) step.startedAt = now;
      if (status === 'completed' || status === 'failed' || status === 'skipped') {
        step.startedAt ??= now;
        step.completedAt = now;
      }
      step.status = status;
      step.detail = detail;
      step.inputIds = uniqueIds(step.inputIds, inputIds);
      step.outputIds = uniqueIds(step.outputIds, outputIds);
    };

    try {
      writeProgress({
        id: 'context',
        label: 'Mission accepted',
        detail: 'A durable plan was written before any case transform started.',
        status: 'active',
      });
      updateStep(
        'recover-context',
        'completed',
        `Recovered revision ${state.metadata.revision}, ${state.evidence.length} artifacts, ${state.researchSessions.length} prior research runs, and ${state.anomalies.filter((item) => item.status === 'open').length} open questions.`,
        state.researchSessions.slice(0, 4).map((item) => item.id),
        state.anomalies.filter((item) => item.status === 'open').map((item) => item.id),
      );
      writeProgress({
        id: 'context',
        label: 'Case context recovered',
        detail: activeMission().steps[0]?.detail ?? 'Case context recovered.',
        status: 'completed',
      });

      const auditSteps: string[] = [];
      if (intent.investigate) {
        const anomaly = selectObjectiveAnomaly(state, instruction);
        if (anomaly) {
          updateStep(
            'investigate-anomaly',
            'running',
            `Objective matched: ${anomaly.question}`,
            anomaly.relatedIds,
          );
          const result = investigateAnomaly(state, anomaly.id);
          state = result.state;
          updateStep(
            'investigate-anomaly',
            'completed',
            result.revision
              ? `${anomaly.question} was worked against its directly linked case objects; the result remains bounded by the evidence returned.`
              : `${anomaly.question} had already been worked; no duplicate revision was created.`,
            anomaly.relatedIds,
            result.revision
              ? [
                  result.revision.id,
                  ...result.revision.changes.map((item) => item.subjectId),
                ]
              : [],
          );
          auditSteps.push(...result.auditSteps);
        } else {
          updateStep(
            'investigate-anomaly',
            'skipped',
            'No open question matched this objective, so no unrelated case transform ran.',
          );
        }
      }

      updateStep('rank-evidence', 'running', 'Ranking evidence for the mission objective.');
      if (scope === 'connected') {
        updateStep(
          'connected-research',
          'running',
          'Aside is searching relevant browser context under the read-only contract.',
        );
      }
      updateStep(
        'challenge-account',
        'running',
        'Testing the strongest account against alternatives and missing evidence.',
      );

      const research = await executeResearch(state, instruction, scope, writeProgress);
      state = research.state;
      updateStep(
        'rank-evidence',
        'completed',
        `${research.packet.retrievalMethod} returned ${research.packet.observationIds.length} observations, ${research.packet.evidenceIds.length} artifacts, and ${research.packet.graphNeighborIds.length} graph neighbors.`,
        research.packet.observationIds,
        [research.packet.id, ...research.packet.evidenceIds],
      );
      updateStep(
        'challenge-account',
        'completed',
        `${research.session.findings.filter((item) => item.status === 'disputed' || item.status === 'retracted').length} challenged findings and ${research.session.negativeFindings.length} checked negatives were retained.`,
        research.packet.observationIds,
        [research.session.id, ...research.session.negativeFindings.map((item) => item.id)],
      );
      if (scope === 'connected') {
        updateStep(
          'connected-research',
          'completed',
          `${research.session.surfaceChecks.filter((item) => ['browser-history', 'public-web', 'connected-app', 'web-archive'].includes(item.surface)).length} connected surface checks completed; located results remain leads until preserved.`,
          research.packet.evidenceIds,
          research.session.surfaceChecks.map((item) => item.id),
        );
      }

      if (intent.watch) {
        const now = new Date().toISOString();
        const existing = state.standingOrders.find(
          (item) =>
            item.enabled &&
            item.scope === scope &&
            item.instruction.toLocaleLowerCase() === instruction.toLocaleLowerCase(),
        );
        const standingOrder: StandingOrder = existing ?? {
          id: `ORDER-${Date.now().toString(36).toUpperCase()}`,
          caseId: state.metadata.id,
          instruction,
          scope,
          trigger: 'new-evidence',
          enabled: true,
          createdAt: now,
          lastTriggeredAt: null,
          lastMissionId: null,
        };
        if (!existing) state.standingOrders.unshift(standingOrder);
        updateStep(
          'watch-for-change',
          'completed',
          'A standing order will compare this objective against every newly preserved artifact.',
          [research.session.id],
          [standingOrder.id],
        );
      }

      const completedAt = new Date().toISOString();
      const completedMission = activeMission();
      completedMission.summary = research.session.answer;
      completedMission.resultSessionId = research.session.id;
      completedMission.runId = research.run.id;
      completedMission.affectedIds = uniqueIds(
        research.run.affectedIds,
        research.packet.evidenceIds,
        completedMission.steps.flatMap((step) => step.outputIds),
      );
      if (intent.requestsExternalWrite) {
        completedMission.status = 'waiting-for-review';
        completedMission.reviewReason =
          'The current connected adapter is read-only. THREAD completed the investigation and did not claim that a message, post, edit, payment, or submission occurred.';
      } else {
        completedMission.status = 'completed';
      }
      completedMission.completedAt = completedAt;
      updateStep(
        'persist-run',
        'completed',
        `Mission, packet, research session, and run ${research.run.id} were persisted together.`,
        [research.session.id, research.packet.id],
        [completedMission.id, research.run.id],
      );
      await store.saveCase(state);
      return {
        ...research,
        state,
        mission: completedMission,
        auditSteps: [
          ...auditSteps,
          ...research.auditSteps,
          ...completedMission.steps
            .filter((step) => step.status === 'completed')
            .map((step) => `${step.label}: ${step.detail}`),
        ],
      };
    } catch (error) {
      const failed = activeMission();
      failed.status = 'failed';
      failed.summary = error instanceof Error ? error.message : 'Mission execution failed.';
      failed.completedAt = new Date().toISOString();
      const running = failed.steps.find((step) => step.status === 'running');
      if (running) {
        running.status = 'failed';
        running.completedAt = failed.completedAt;
        running.detail = failed.summary;
      }
      await store.saveCase(state);
      throw error;
    }
  }

  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(
    cors({
      origin: [/^http:\/\/127\.0\.0\.1:\d+$/u, /^http:\/\/localhost:\d+$/u],
      methods: ['GET', 'POST'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', async (_request, response) => {
    response.json(
      await integrationStatus(environment, store, providers, connectedResearch),
    );
  });

  app.get('/api/integrity', async (_request, response) => {
    const cases = await store.listCases();
    const reports = (
      await Promise.all(
        cases.map(async (metadata) => {
          const state = await store.getCase(metadata.id);
          return state ? validateCaseIntegrity(state) : null;
        }),
      )
    ).filter((report): report is NonNullable<typeof report> => Boolean(report));
    const ok = reports.every((report) => report.ok);
    return response.status(ok ? 200 : 503).json({ ok, reports });
  });

  app.post('/api/integrations/verify', async (_request, response) => {
    await providers.verify();
    response.json(
      await integrationStatus(environment, store, providers, connectedResearch),
    );
  });

  app.get('/api/cases', async (_request, response) => {
    response.json({ cases: await store.listCases() });
  });

  app.post('/api/cases', async (request, response) => {
    const parsed = newCaseFields.safeParse(request.body);
    if (!parsed.success) {
      return response
        .status(400)
        .json({ error: 'Invalid case details.', details: parsed.error.flatten() });
    }
    const existing = await store.listCases();
    const taken = new Set(existing.map((item) => item.id));
    const state = createEmptyCase({
      id: uniqueCaseId(parsed.data.title, taken),
      title: parsed.data.title,
      ...(parsed.data.subtitle === undefined ? {} : { subtitle: parsed.data.subtitle }),
      ...(parsed.data.classification === undefined
        ? {}
        : { classification: parsed.data.classification }),
      ...(parsed.data.location === undefined ? {} : { location: parsed.data.location }),
    });
    await store.saveCase(state);
    return response.status(201).json({ state });
  });

  app.get('/api/cases/:caseId', async (request, response) => {
    const state = await store.getCase(request.params.caseId);
    if (!state) return response.status(404).json({ error: 'Case not found.' });
    return response.json({ state });
  });

  app.delete('/api/cases/:caseId', async (request, response) => {
    const caseId = String(request.params.caseId);
    if (isBundledCase(caseId)) {
      return response.status(409).json({
        error: 'This is a bundled demonstration case and cannot be deleted.',
      });
    }
    const deleted = await store.deleteCase(caseId);
    if (!deleted) return response.status(404).json({ error: 'Case not found.' });
    return response.status(200).json({ deleted: caseId });
  });

  /**
   * Invalidates a warrant the case rests on and cascades the consequences.
   * The investigator makes the judgment; the engine propagates it.
   */
  app.post(
    '/api/cases/:caseId/assumptions/:assumptionId/challenge',
    async (request, response) => {
      const caseId = String(request.params.caseId);
      const assumptionId = String(request.params.assumptionId);
      const state = await store.getCase(caseId);
      if (!state) return response.status(404).json({ error: 'Case not found.' });
      if (!state.assumptions.some((item) => item.id === assumptionId)) {
        return response.status(404).json({ error: 'Assumption not found in this case.' });
      }
      const parsed = challengeFields.safeParse(request.body ?? {});
      if (!parsed.success) {
        return response
          .status(400)
          .json({ error: 'Invalid challenge.', details: parsed.error.flatten() });
      }
      const result = challengeAssumption(state, assumptionId, {
        ...(parsed.data.evidenceId === undefined
          ? {}
          : { evidenceId: parsed.data.evidenceId }),
      });
      if (!result.revision) {
        return response.json({
          state: result.state,
          revision: null,
          auditSteps: result.auditSteps,
        });
      }
      await store.saveCase(result.state);
      const packet = await store.buildCasePacket(
        result.state,
        `What survives without “${assumptionId}”?`,
      );
      result.state.casePackets.unshift(packet);
      const run = await attachRun({
        state: result.state,
        orchestrator,
        trigger: `Challenged assumption ${assumptionId}`,
        affectedIds: uniqueIds(
          [assumptionId],
          result.revision.changes.map((change) => change.subjectId),
        ),
        packetId: packet.id,
        selectedAgents: ['FALSIFIER', 'LINKER', 'HYPOTHESIS ENGINE', 'INVESTIGATOR'],
      });
      await store.saveCase(result.state);
      return response.json({
        state: result.state,
        revision: result.revision,
        auditSteps: [...result.auditSteps, `LangGraph run ${run.id} recorded the cascade.`],
      });
    },
  );

  /**
   * Re-derives the whole case from its preserved records. Nothing is
   * re-extracted and no artifact is touched; only the derived layer is rebuilt.
   */
  app.post('/api/cases/:caseId/infer', async (request, response) => {
    const caseId = String(request.params.caseId);
    const state = await store.getCase(caseId);
    if (!state) return response.status(404).json({ error: 'Case not found.' });
    const result = runInferencePass(state);
    if (!result.revision) {
      return response.json({
        state: result.state,
        revision: null,
        auditSteps: result.auditSteps,
      });
    }
    await store.saveCase(result.state);
    const packet = await store.buildCasePacket(
      result.state,
      'What does the case record support after re-derivation?',
    );
    result.state.casePackets.unshift(packet);
    const run = await attachRun({
      state: result.state,
      orchestrator,
      trigger: 'Re-derived the case from its preserved records',
      affectedIds: uniqueIds(
        result.state.entities.map((item) => item.id),
        result.state.worldEdges.map((item) => item.id),
      ),
      packetId: packet.id,
      selectedAgents: [
        'RESOLVER',
        'CHRONOLOGIST',
        'LINKER',
        'HYPOTHESIS ENGINE',
        'FALSIFIER',
        'INVESTIGATOR',
      ],
    });
    await store.saveCase(result.state);
    return response.json({
      state: result.state,
      revision: result.revision,
      auditSteps: [...result.auditSteps, `LangGraph run ${run.id} recorded the pass.`],
    });
  });

  app.get('/api/cases/:caseId/evidence/:evidenceId/content', async (request, response) => {
    const state = await store.getCase(request.params.caseId);
    if (!state) return response.status(404).json({ error: 'Case not found.' });
    const artifact = state.evidence.find((item) => item.id === request.params.evidenceId);
    if (!artifact) return response.status(404).json({ error: 'Evidence not found.' });
    if (!artifact.rawLocator || artifact.synthetic) {
      return response.status(404).json({
        error: 'This evidence artifact has no user-uploaded binary preview.',
      });
    }
    const resolvedRoot = resolve(rawDirectory);
    const resolvedFile = resolve(artifact.rawLocator);
    if (!resolvedFile.startsWith(`${resolvedRoot}/`)) {
      return response.status(403).json({ error: 'Evidence locator is outside storage.' });
    }
    const mime = previewMimeTypes[extname(resolvedFile).toLowerCase()];
    if (!mime || !artifact.mimeType.startsWith('image/')) {
      return response.status(415).json({
        error: 'Only preserved image artifacts can be previewed on the board.',
      });
    }
    response.type(mime);
    response.setHeader('Cache-Control', 'private, max-age=60');
    return response.send(await readFile(resolvedFile));
  });

  app.post(
    '/api/cases/:caseId/evidence/clarifications/:clarificationId',
    async (request, response) => {
      const state = await store.getCase(String(request.params.caseId));
      if (!state) return response.status(404).json({ error: 'Case not found.' });
      const parsed = clarificationAnswerFields.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ error: 'Choose one clarification answer.' });
      }
      const clarification = state.clarifications.find(
        (item) => item.id === request.params.clarificationId,
      );
      if (!clarification) {
        return response.status(404).json({ error: 'Clarification not found.' });
      }
      if (clarification.status === 'answered') {
        return response.json({
          state,
          clarification,
          auditSteps: ['This clarification answer was already recorded.'],
        });
      }
      const custom = parsed.data.choiceId === 'custom';
      if (
        !custom &&
        !clarification.choices.some((choice) => choice.id === parsed.data.choiceId)
      ) {
        return response.status(400).json({ error: 'Unknown clarification choice.' });
      }
      if (custom && !parsed.data.customAnswer) {
        return response.status(400).json({
          error: 'Describe the alternative only when “Something else” is selected.',
        });
      }
      clarification.status = 'answered';
      clarification.selectedChoiceId = parsed.data.choiceId;
      clarification.customAnswer = custom ? parsed.data.customAnswer! : null;
      clarification.answeredAt = new Date().toISOString();
      await store.saveCase(state);
      return response.json({
        state,
        clarification,
        auditSteps: [
          `Investigator classification context was attached to ${clarification.evidenceId}.`,
          'The immutable source was not rewritten and no world fact was created.',
        ],
      });
    },
  );

  app.get('/api/cases/:caseId/interview/session', async (request, response) => {
    const state = await store.getCase(request.params.caseId);
    if (!state) return response.status(404).json({ error: 'Case not found.' });
    const session = await providers.signedInterviewSession(state);
    return response.json(session);
  });

  app.post('/api/cases/:caseId/research', async (request, response) => {
    const state = await store.getCase(request.params.caseId);
    if (!state) return response.status(404).json({ error: 'Case not found.' });
    const parsed = researchFields.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({
        error: 'Ask one bounded research question.',
        details: parsed.error.flatten(),
      });
    }
    return response.json(
      await executeResearch(state, parsed.data.question, parsed.data.scope),
    );
  });

  app.post('/api/cases/:caseId/research/stream', async (request, response) => {
    const state = await store.getCase(request.params.caseId);
    if (!state) return response.status(404).json({ error: 'Case not found.' });
    const parsed = researchFields.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({ error: 'Ask one bounded research question.' });
    }
    response.status(200);
    response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    const write = (payload: object) => {
      if (!response.writableEnded) response.write(`${JSON.stringify(payload)}\n`);
    };
    try {
      const result = await executeResearch(
        state,
        parsed.data.question,
        parsed.data.scope,
        (progress) => write({ type: 'progress', progress }),
      );
      write({ type: 'complete', result });
    } catch (error) {
      write({
        type: 'error',
        error: error instanceof Error ? error.message : 'Research failed.',
      });
    }
    return response.end();
  });

  app.post('/api/cases/:caseId/missions', async (request, response) => {
    const state = await store.getCase(request.params.caseId);
    if (!state) return response.status(404).json({ error: 'Case not found.' });
    const parsed = missionFields.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({
        error: 'Tell THREAD one concrete outcome to pursue.',
        details: parsed.error.flatten(),
      });
    }
    return response.json(
      await executeMission(state, parsed.data.instruction, parsed.data.scope),
    );
  });

  app.post('/api/cases/:caseId/missions/stream', async (request, response) => {
    const state = await store.getCase(request.params.caseId);
    if (!state) return response.status(404).json({ error: 'Case not found.' });
    const parsed = missionFields.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({
        error: 'Tell THREAD one concrete outcome to pursue.',
        details: parsed.error.flatten(),
      });
    }
    response.status(200);
    response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    const write = (payload: object) => {
      if (!response.writableEnded) response.write(`${JSON.stringify(payload)}\n`);
    };
    try {
      const result = await executeMission(
        state,
        parsed.data.instruction,
        parsed.data.scope,
        (progress) => write({ type: 'progress', progress }),
      );
      write({ type: 'complete', result });
    } catch (error) {
      write({
        type: 'error',
        error: error instanceof Error ? error.message : 'Mission failed.',
      });
    }
    return response.end();
  });

  app.post('/api/cases/:caseId/reasoning/review', async (request, response) => {
    const state = await store.getCase(request.params.caseId);
    if (!state) return response.status(404).json({ error: 'Case not found.' });
    const parsed = reviewFields.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({
        error: 'A bounded review question is required.',
        details: parsed.error.flatten(),
      });
    }
    const packet = await store.buildCasePacket(state, parsed.data.question);
    const review = await providers.adversarialReview(state, packet);
    const reconstructionIds = new Set(state.reconstructions.map((item) => item.id));
    const unknownIds = [
      [review.hypothesisModel, review.hypothesis.leading_reconstruction_id] as const,
      [review.falsifierModel, review.falsifier.alternative_reconstruction_id] as const,
    ].filter(([, id]) => !reconstructionIds.has(id));
    if (unknownIds.length > 0) {
      throw new Error(
        `A review model returned a reconstruction ID outside the case: ${unknownIds
          .map(([model, id]) => `${model} chose ${id}`)
          .join('; ')}. Known reconstructions: ${[...reconstructionIds].join(', ')}.`,
      );
    }
    const now = new Date().toISOString();
    state.casePackets.unshift(packet);
    state.beliefMemory.unshift(
      {
        id: `MB-REVIEW-H-${Date.now().toString(36).toUpperCase()}`,
        caseId: state.metadata.id,
        kind: 'belief',
        subjectId: review.hypothesis.leading_reconstruction_id,
        summary: review.hypothesis.summary,
        sourceIds: uniqueIds(packet.observationIds, packet.evidenceIds),
        confidence: 0.5,
        revision: state.metadata.revision,
        updatedAt: now,
      },
      {
        id: `MB-REVIEW-F-${Date.now().toString(36).toUpperCase()}`,
        caseId: state.metadata.id,
        kind: 'belief',
        subjectId: review.falsifier.alternative_reconstruction_id,
        summary: review.falsifier.strongest_counterargument,
        sourceIds: uniqueIds(packet.observationIds, packet.evidenceIds),
        confidence: 0.5,
        revision: state.metadata.revision,
        updatedAt: now,
      },
    );
    const run = await attachRun({
      state,
      orchestrator,
      trigger: `Adversarial review: ${parsed.data.question}`,
      affectedIds: uniqueIds(packet.observationIds, packet.evidenceIds, [
        review.hypothesis.leading_reconstruction_id,
        review.falsifier.alternative_reconstruction_id,
      ]),
      packetId: packet.id,
      selectedAgents: ['HYPOTHESIS ENGINE', 'FALSIFIER', 'INVESTIGATOR'],
      providerDetails: {
        'HYPOTHESIS ENGINE': {
          provider: 'openrouter',
          model: review.hypothesisModel,
          detail: review.hypothesis.summary,
          inputIds: uniqueIds(packet.observationIds, packet.evidenceIds),
          outputIds: [review.hypothesis.leading_reconstruction_id],
        },
        FALSIFIER: {
          provider: 'openrouter',
          model: review.falsifierModel,
          detail: review.falsifier.strongest_counterargument,
          inputIds: uniqueIds(packet.observationIds, [
            review.hypothesis.leading_reconstruction_id,
          ]),
          outputIds: uniqueIds(review.falsifier.contradicting_ids, [
            review.falsifier.alternative_reconstruction_id,
          ]),
        },
        INVESTIGATOR: {
          provider: 'deterministic',
          model: null,
          detail: `Validated both model responses against the bounded IDs in ${packet.id} and stored them as belief memory.`,
          inputIds: [packet.id],
          outputIds: [review.hypothesis.leading_reconstruction_id],
        },
      },
    });
    await store.saveCase(state);
    return response.json({
      state,
      packet,
      review,
      run,
      auditSteps: [
        `${packet.retrievalMethod} assembled ${packet.observationIds.length} observations.`,
        `${review.hypothesisModel} evaluated explanatory coverage.`,
        `${review.falsifierModel} independently attacked the leading account.`,
        'Model output was stored as belief memory, not promoted to evidence or a world fact.',
      ],
    });
  });

  app.post('/api/cases/:caseId/investigations/:anomalyId', async (request, response) => {
    const state = await store.getCase(request.params.caseId);
    if (!state) return response.status(404).json({ error: 'Case not found.' });
    const anomaly = state.anomalies.find((item) => item.id === request.params.anomalyId);
    if (!anomaly)
      return response
        .status(404)
        .json({ error: `Unknown anomaly: ${request.params.anomalyId}` });
    const packet = await store.buildCasePacket(state, anomaly.question);
    const result = investigateAnomaly(state, anomaly.id);
    if (result.revision) {
      result.state.casePackets.unshift(packet);
      const run = await attachRun({
        state: result.state,
        orchestrator,
        trigger: `Investigated ${anomaly.id}: ${anomaly.question}`,
        affectedIds: uniqueIds(
          anomaly.relatedIds,
          packet.observationIds,
          packet.evidenceIds,
          result.revision.changes.map((change) => change.subjectId),
        ),
        packetId: packet.id,
        selectedAgents: ['RESOLVER', 'CHRONOLOGIST', 'LINKER', 'FALSIFIER', 'INVESTIGATOR'],
        providerDetails: {
          RESOLVER: {
            provider: 'deterministic',
            model: null,
            detail:
              result.auditSteps.find((step) => step.startsWith('RESOLVER')) ??
              `Checked candidate bindings linked to ${anomaly.id}.`,
            inputIds: anomaly.relatedIds,
            outputIds: result.revision.changes
              .filter((change) => change.kind === 'reference')
              .map((change) => change.subjectId),
          },
          CHRONOLOGIST: {
            provider: 'deterministic',
            model: null,
            detail:
              result.auditSteps.find((step) => step.startsWith('CHRONOLOGIST')) ??
              'Checked source-bound intervals in the affected packet; no timestamp precision was invented.',
            inputIds: packet.observationIds,
            outputIds: state.temporalConstraints
              .filter((constraint) =>
                constraint.sourceIds.some((id) => packet.observationIds.includes(id)),
              )
              .map((constraint) => constraint.id),
          },
          LINKER: {
            provider: 'deterministic',
            model: null,
            detail:
              result.auditSteps.find((step) => step.startsWith('LINKER')) ??
              'Recomputed only provenance-bound relationships in the affected subgraph.',
            inputIds: uniqueIds(anomaly.relatedIds, packet.graphNeighborIds),
            outputIds: result.revision.changes
              .filter((change) => change.kind === 'edge')
              .map((change) => change.subjectId),
          },
          FALSIFIER: {
            provider: 'deterministic',
            model: null,
            detail:
              result.auditSteps.find((step) => step.startsWith('FALSIFIER')) ??
              'Checked whether the returned sources justified collapsing the alternatives.',
            inputIds: packet.observationIds,
            outputIds: result.state.beliefs
              .filter(
                (belief) => belief.status === 'weakened' || belief.status === 'rejected',
              )
              .map((belief) => belief.id),
          },
          INVESTIGATOR: {
            provider: 'deterministic',
            model: null,
            detail: result.revision.summary,
            inputIds: [anomaly.id, packet.id],
            outputIds: [result.revision.id],
          },
        },
      });
      result.auditSteps.push(
        `${packet.retrievalMethod} bounded the working context to ${packet.observationIds.length} observations.`,
        `LangGraph checkpoint ${run.checkpointId ?? 'not configured'} recorded the affected-subgraph run.`,
      );
      await store.saveCase(result.state);
    }
    return response.json(result);
  });

  app.post('/api/cases/:caseId/evidence/demo-143', async (request, response) => {
    const state = await store.getCase(request.params.caseId);
    if (!state) return response.status(404).json({ error: 'Case not found.' });
    const result = applyCounterEvidence(state);
    if (result.revision) {
      // Persist the new snapshot before hybrid retrieval so Atlas indexes EV-143.
      await store.saveCase(result.state);
      const packet = await store.buildCasePacket(
        result.state,
        'How does the Pier 48 V17 observation change the warehouse reconstruction?',
      );
      result.state.casePackets.unshift(packet);
      const run = await attachRun({
        state: result.state,
        orchestrator,
        trigger: 'EV-143 counter-evidence changed the affected subgraph',
        affectedIds: uniqueIds(
          ['EV-143', 'O-143-V17', 'A-19'],
          result.revision.changes.map((change) => change.subjectId),
        ),
        packetId: packet.id,
        selectedAgents: [
          'INGESTOR',
          'CHRONOLOGIST',
          'LINKER',
          'HYPOTHESIS ENGINE',
          'FALSIFIER',
          'INVESTIGATOR',
        ],
        providerDetails: {
          INGESTOR: {
            provider: 'deterministic',
            model: null,
            detail:
              'Preserved EV-143 as an explicitly synthetic fixture and retained its source-bound observation separately.',
            inputIds: ['EV-143'],
            outputIds: ['EV-143', 'O-143-V17'],
          },
          CHRONOLOGIST: {
            provider: 'deterministic',
            model: null,
            detail:
              'Compared the exact 21:06:14 frame time with the existing fuzzy arrival interval.',
            inputIds: ['O-143-V17'],
            outputIds: result.state.temporalConstraints.map((item) => item.id),
          },
          LINKER: {
            provider: 'deterministic',
            model: null,
            detail:
              'Added the sourced V17-to-Pier 48 relationship and weakened only edges depending on A-19.',
            inputIds: ['O-143-V17', 'A-19'],
            outputIds: ['WE-VEHICLE-PIER48'],
          },
          'HYPOTHESIS ENGINE': {
            provider: 'deterministic',
            model: null,
            detail:
              'Recomputed weighted coverage after the A-19 environment became invalid.',
            inputIds: ['EV-143', 'A-19'],
            outputIds: ['R-A', 'R-C'],
          },
          FALSIFIER: {
            provider: 'deterministic',
            model: null,
            detail:
              'Propagated the A-19 nogood through dependent beliefs and retained the competing reconstruction.',
            inputIds: ['A-19'],
            outputIds: result.state.beliefs
              .filter(
                (belief) => belief.status === 'weakened' || belief.status === 'rejected',
              )
              .map((belief) => belief.id),
          },
          INVESTIGATOR: {
            provider: 'deterministic',
            model: null,
            detail: result.revision.summary,
            inputIds: [packet.id],
            outputIds: [result.revision.id],
          },
        },
      });
      result.auditSteps.push(
        `${packet.retrievalMethod} assembled the post-change case packet.`,
        `LangGraph stored ${run.steps.filter((step) => step.status === 'completed').length} completed transforms.`,
      );
      await store.saveCase(result.state);
    }
    return response.json(result);
  });

  app.post(
    '/api/cases/:caseId/evidence',
    upload.single('file'),
    async (request, response) => {
      const state = await store.getCase(String(request.params.caseId));
      if (!state) return response.status(404).json({ error: 'Case not found.' });
      if (!request.file)
        return response.status(400).json({ error: 'One evidence file is required.' });
      const parsed = uploadFields.safeParse(request.body);
      if (!parsed.success) {
        return response
          .status(400)
          .json({ error: 'Invalid evidence metadata.', details: parsed.error.flatten() });
      }
      const digest = createHash('sha256').update(request.file.buffer).digest('hex');
      await mkdir(rawDirectory, { recursive: true });
      const storedName = `${digest.slice(0, 16)}-${safeFileName(request.file.originalname)}`;
      const rawLocator = join(rawDirectory, storedName);
      await writeFile(rawLocator, request.file.buffer);
      const extraction = await extractUpload({
        file: request.file,
        rawLocator,
        state,
        providers,
      });
      const result = ingestLocalEvidence(state, {
        ...parsed.data,
        sourceReliability: parsed.data.sourceReliability,
        informationCredibility: parsed.data
          .informationCredibility as InformationCredibility,
        fileName: request.file.originalname,
        mimeType: request.file.mimetype || 'application/octet-stream',
        sha256: digest,
        content: extraction.content,
        rawLocator,
        extractionStatus: extraction.extractionStatus,
        extractor: extraction.extractor,
        externalObservations: extraction.externalObservations,
      });
      const detectedKind = inferEvidenceKind(
        request.file.originalname,
        request.file.mimetype,
      );
      let clarification: EvidenceClarification | null = null;
      if (
        result.revision?.triggerEvidenceId &&
        isMaterialEvidenceKindConflict(parsed.data.kind, detectedKind)
      ) {
        clarification = createClassificationClarification({
          caseId: result.state.metadata.id,
          evidenceId: result.revision.triggerEvidenceId,
          submittedKind: parsed.data.kind,
          detectedKind,
          createdAt: result.revision.createdAt,
        });
        result.state.clarifications.unshift(clarification);
        result.auditSteps.push(
          `CLARIFICATION · Submitted type ${parsed.data.kind} conflicts with detected container ${detectedKind}; preservation continued without guessing.`,
        );
      }
      result.auditSteps.push(
        ...extraction.warnings.map((warning) => `WARNING · ${warning}`),
      );
      // Preserving an artifact is not the same as understanding it. The
      // derivation pass is what turns the preserved record into entities,
      // relationships, contradictions and ranked questions.
      const entitiesBefore = result.state.entities.length;
      const edgesBefore = result.state.worldEdges.length;
      const inference = runInferencePass(result.state, {
        ...(result.revision ? { timestamp: result.revision.createdAt } : {}),
        // Only the newly preserved artifact is read for mentions and
        // relationships; case-wide stages still judge it against everything.
        ...(result.revision?.triggerEvidenceId
          ? { evidenceScope: [result.revision.triggerEvidenceId] }
          : {}),
      });
      result.state = inference.state;
      result.auditSteps.push(...inference.auditSteps);
      const derivedEntities = result.state.entities.length - entitiesBefore;
      const derivedEdges = result.state.worldEdges.length - edgesBefore;
      if (result.revision) {
        await store.saveCase(result.state);
        const evidenceId = result.revision.triggerEvidenceId;
        const packet = await store.buildCasePacket(
          result.state,
          `What changed after ingesting ${parsed.data.title}?`,
        );
        result.state.casePackets.unshift(packet);
        const uploadedArtifact = result.state.evidence.find(
          (item) => item.id === evidenceId,
        );
        const uploadedObservations = result.state.observations.filter(
          (item) => item.sourceEvidenceId === evidenceId,
        );
        const uploadedClaims = result.state.claims.filter(
          (item) => item.sourceEvidenceId === evidenceId,
        );
        const uploadedReferences = result.state.unresolvedReferences.filter((item) =>
          evidenceId ? item.sourceEvidenceIds.includes(evidenceId) : false,
        );
        const ingestorProvider =
          extraction.extractor === 'elevenlabs'
            ? ('elevenlabs' as const)
            : extraction.extractor === 'fireworks'
              ? ('fireworks' as const)
              : ('deterministic' as const);
        const ingestorModel =
          extraction.extractor === 'elevenlabs'
            ? (extraction.providerModel ?? 'scribe_v2')
            : extraction.extractor === 'fireworks'
              ? (extraction.providerModel ??
                environment.FIREWORKS_VISION_MODEL ??
                'accounts/fireworks/models/inkling')
              : null;
        const run = await attachRun({
          state: result.state,
          orchestrator,
          trigger: `Ingested ${parsed.data.title}`,
          affectedIds: uniqueIds(
            evidenceId ? [evidenceId] : [],
            packet.observationIds,
            packet.evidenceIds,
          ),
          packetId: packet.id,
          selectedAgents: [
            'INGESTOR',
            'RESOLVER',
            'CHRONOLOGIST',
            'LINKER',
            'HYPOTHESIS ENGINE',
            'FALSIFIER',
            'INVESTIGATOR',
          ],
          providerDetails: {
            INGESTOR: {
              provider: ingestorProvider,
              model: ingestorModel,
              detail:
                extraction.extractor === 'elevenlabs'
                  ? `Scribe v2 produced a verbatim transcript and ${uploadedObservations.length} source-bound observation${uploadedObservations.length === 1 ? '' : 's'}.`
                  : extraction.extractor === 'fireworks'
                    ? `Fireworks returned ${uploadedObservations.length} schema-validated atomic visual observation${uploadedObservations.length === 1 ? '' : 's'}.`
                    : `The local extractor preserved ${uploadedArtifact?.extractionStatus ?? 'unknown'} output as ${uploadedObservations.length} observation${uploadedObservations.length === 1 ? '' : 's'} and ${uploadedClaims.length} attributed claim${uploadedClaims.length === 1 ? '' : 's'}.`,
              inputIds: evidenceId ? [evidenceId] : [],
              outputIds: uniqueIds(
                uploadedObservations.map((item) => item.id),
                uploadedClaims.map((item) => item.id),
              ),
            },
            RESOLVER: {
              provider: 'deterministic',
              model: null,
              detail: `Derived ${derivedEntities} entit${derivedEntities === 1 ? 'y' : 'ies'} and retained ${uploadedReferences.length} vague reference${uploadedReferences.length === 1 ? '' : 's'} as unresolved candidates; no entity was hard-merged.`,
              inputIds: uploadedClaims.map((item) => item.id),
              outputIds: uploadedReferences.map((item) => item.id),
            },
            CHRONOLOGIST: {
              provider: 'deterministic',
              model: null,
              detail: `Checked ${uploadedObservations.filter((item) => item.interval).length} extracted time interval${uploadedObservations.filter((item) => item.interval).length === 1 ? '' : 's'} without inventing missing precision.`,
              inputIds: uploadedObservations.map((item) => item.id),
              outputIds: uploadedObservations
                .filter((item) => item.interval)
                .map((item) => item.id),
            },
            LINKER: {
              provider: 'deterministic',
              model: null,
              detail: `Derived ${derivedEdges} relationship${derivedEdges === 1 ? '' : 's'}; each one carries its source records and the assumption its derivation required.`,
              inputIds: uploadedObservations.map((item) => item.id),
              outputIds: result.state.worldEdges
                .slice(0, derivedEdges)
                .map((item) => item.id),
            },
            'HYPOTHESIS ENGINE': {
              provider: 'deterministic',
              model: null,
              detail: `Rebuilt ${result.state.reconstructions.length} competing account${result.state.reconstructions.length === 1 ? '' : 's'} without selecting one.`,
              inputIds: result.state.worldEdges.map((item) => item.id),
              outputIds: result.state.reconstructions.map((item) => item.id),
            },
            FALSIFIER: {
              provider: 'deterministic',
              model: null,
              detail: `${result.state.beliefs.filter((item) => item.kind === 'contradiction').length} contradiction${result.state.beliefs.filter((item) => item.kind === 'contradiction').length === 1 ? '' : 's'} currently stand on the record.`,
              inputIds: result.state.worldEdges.map((item) => item.id),
              outputIds: result.state.beliefs
                .filter((item) => item.kind === 'contradiction')
                .map((item) => item.id),
            },
            INVESTIGATOR: {
              provider: 'deterministic',
              model: null,
              detail: `Ranked ${result.state.anomalies.length} open question${result.state.anomalies.length === 1 ? '' : 's'} by expected information gain.`,
              inputIds: [],
              outputIds: result.state.anomalies.map((item) => item.id),
            },
          },
        });
        result.auditSteps.push(
          `${packet.retrievalMethod} built ${packet.id}.`,
          `LangGraph run ${run.id} checkpointed the selected transforms.`,
        );
        const ingestedArtifact = result.state.evidence.find(
          (item) => item.id === evidenceId,
        );
        if (ingestedArtifact) {
          const completedAt = new Date().toISOString();
          const relatedQuestion = selectObjectiveAnomaly(
            result.state,
            `${ingestedArtifact.title} ${ingestedArtifact.sourceLabel} ${ingestedArtifact.content ?? ''}`,
          );
          const missionId = `MISSION-INTAKE-${Date.now().toString(36).toUpperCase()}`;
          const triageMission: AgentMission = {
            id: missionId,
            caseId: result.state.metadata.id,
            instruction: `Triage newly preserved evidence: ${ingestedArtifact.title}`,
            objective:
              'Index the new source, measure which open question it touches, and leave the next move visible.',
            scope: 'case',
            status: 'completed',
            initiatedBy: 'evidence-intake',
            steps: [
              {
                id: `${missionId}-S1`,
                capability: 'recover-context',
                label: 'Preserved before interpretation',
                detail: `${ingestedArtifact.id} was retained with SHA-256 ${ingestedArtifact.sha256.slice(0, 12)}… before the case model used it.`,
                status: 'completed',
                inputIds: [ingestedArtifact.id],
                outputIds: [ingestedArtifact.id],
                startedAt: completedAt,
                completedAt,
              },
              {
                id: `${missionId}-S2`,
                capability: 'rank-evidence',
                label: 'Re-ranked the case packet',
                detail: `${packet.retrievalMethod} compared the artifact with ${packet.observationIds.length} observations and ${packet.graphNeighborIds.length} relationship neighbors.`,
                status: 'completed',
                inputIds: [ingestedArtifact.id],
                outputIds: [packet.id, ...packet.observationIds],
                startedAt: completedAt,
                completedAt,
              },
              {
                id: `${missionId}-S3`,
                capability: 'persist-run',
                label: 'Left the next move visible',
                detail: relatedQuestion
                  ? `Related unresolved question: ${relatedQuestion.question}`
                  : 'No open question matched this source; it remains indexed for future comparison.',
                status: 'completed',
                inputIds: relatedQuestion ? [relatedQuestion.id] : [],
                outputIds: [run.id],
                startedAt: completedAt,
                completedAt,
              },
            ],
            summary: relatedQuestion
              ? `${ingestedArtifact.title} is preserved and indexed. It may bear on “${relatedQuestion.question}”`
              : `${ingestedArtifact.title} is preserved and indexed; no unrelated question was attached to it.`,
            resultSessionId: null,
            runId: run.id,
            affectedIds: uniqueIds([ingestedArtifact.id], packet.observationIds),
            reviewReason: null,
            createdAt: completedAt,
            startedAt: completedAt,
            completedAt,
          };
          result.state.missions.unshift(triageMission);

          const haystack =
            `${ingestedArtifact.title} ${ingestedArtifact.content ?? ''}`.toLocaleLowerCase();
          for (const order of result.state.standingOrders.filter((item) => item.enabled)) {
            const terms = order.instruction
              .toLocaleLowerCase()
              .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
              .split(/\s+/u)
              .filter((term) => term.length > 3);
            const matches = [...new Set(terms.filter((term) => haystack.includes(term)))];
            const orderMissionId = `MISSION-ORDER-${Date.now().toString(36).toUpperCase()}-${order.id.slice(-4)}`;
            result.state.missions.unshift({
              id: orderMissionId,
              caseId: result.state.metadata.id,
              instruction: order.instruction,
              objective: 'Check the standing instruction against newly preserved evidence.',
              scope: 'case',
              status: 'completed',
              initiatedBy: 'standing-order',
              steps: [
                {
                  id: `${orderMissionId}-S1`,
                  capability: 'watch-for-change',
                  label: 'Compared the new artifact with the standing order',
                  detail:
                    matches.length > 0
                      ? `Matched ${matches.length} objective term${matches.length === 1 ? '' : 's'}: ${matches.join(', ')}.`
                      : 'No direct objective-term match was found; the negative check is retained.',
                  status: 'completed',
                  inputIds: [order.id, ingestedArtifact.id],
                  outputIds: matches.length > 0 ? [ingestedArtifact.id] : [],
                  startedAt: completedAt,
                  completedAt,
                },
              ],
              summary:
                matches.length > 0
                  ? `${ingestedArtifact.title} may affect the standing instruction and is ready for a full mission.`
                  : `${ingestedArtifact.title} did not match the standing instruction in the deterministic intake check.`,
              resultSessionId: null,
              runId: run.id,
              affectedIds: matches.length > 0 ? [ingestedArtifact.id] : [],
              reviewReason: null,
              createdAt: completedAt,
              startedAt: completedAt,
              completedAt,
            });
            order.lastTriggeredAt = completedAt;
            order.lastMissionId = orderMissionId;
          }
          result.auditSteps.push(
            `MISSION · ${triageMission.summary ?? 'New evidence triage completed.'}`,
          );
        }
        await store.saveCase(result.state);
      }
      const artifact = result.state.evidence.find(
        (item) => item.id === result.revision?.triggerEvidenceId || item.sha256 === digest,
      )!;
      const receipt: EvidenceIngestionReceipt = {
        outcome: result.revision ? 'preserved' : 'duplicate',
        evidenceId: artifact.id,
        fileName: artifact.fileName,
        sha256: artifact.sha256,
        extractionStatus: artifact.extractionStatus,
        extractor: artifact.extractor,
        observationCount: artifact.observationIds.length,
        claimCount: artifact.claimIds.length,
        unresolvedReferenceCount: result.state.unresolvedReferences.filter((reference) =>
          reference.sourceEvidenceIds.includes(artifact.id),
        ).length,
        warnings: extraction.warnings,
        clarificationId: clarification?.id ?? null,
      };
      return response.status(result.revision ? 201 : 200).json({ ...result, receipt });
    },
  );

  app.post('/api/demo/reset', async (_request, response) => {
    response.json({ state: await store.resetDemo() });
  });

  app.post('/api/cases/:caseId/reset', async (request, response) => {
    const existing = await store.getCase(request.params.caseId);
    if (!existing) return response.status(404).json({ error: 'Case not found.' });
    return response.json({ state: await store.resetDemo(existing.metadata.id) });
  });

  app.get('/api/demo', (_request, response) => {
    response.redirect(`/api/cases/${sampleCaseId}`);
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    if (error instanceof multer.MulterError) {
      response.status(400).json({ error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    response.status(500).json({ error: message });
  };
  app.use(errorHandler);
  return app;
}
