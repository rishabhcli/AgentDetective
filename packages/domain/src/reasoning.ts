import type {
  Belief,
  CandidateBinding,
  CaseRevision,
  CaseState,
  EvidenceArtifact,
  EvidenceKind,
  MutationResult,
  Observation,
  SourceReliability,
  InformationCredibility,
  Claim,
  TimeInterval,
  TemporalConstraint,
  UnresolvedReference,
} from './types.js';

const SIGNAL_SCALE = 0.73;

function round(value: number, places = 2): number {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function nowOr(value: string | undefined): string {
  return value ?? new Date().toISOString();
}

function nextRevisionId(state: CaseState): string {
  return `REV-${String(state.metadata.revision + 1).padStart(3, '0')}`;
}

function nextObjectId(prefix: string, state: CaseState): string {
  const suffix = `${state.metadata.revision + 1}-${Date.now().toString(36).toUpperCase()}`;
  return `${prefix}-${suffix}`;
}

export function calculateCoverage(explainedPoints: number, materialPoints: number): number {
  if (materialPoints <= 0) return 0;
  return Math.round((explainedPoints / materialPoints) * 100);
}

export function scoreCandidateBindings(reference: UnresolvedReference): CandidateBinding[] {
  const scores = reference.candidateBindings.map((candidate) => {
    const matchingSignals = reference.resolutionSignals.filter(
      (signal) => signal.candidateEntityId === candidate.entityId,
    );
    const evidenceWeight = matchingSignals.reduce(
      (total, signal) => total + signal.weight,
      0,
    );
    const logit =
      Math.log(Math.max(candidate.prior, 0.0001)) + evidenceWeight * SIGNAL_SCALE;
    return {
      ...candidate,
      raw: Math.exp(logit),
      signalIds: matchingSignals.map((signal) => signal.id),
    };
  });
  const denominator = scores.reduce((total, candidate) => total + candidate.raw, 0);
  return scores
    .map(({ raw, ...candidate }) => ({
      ...candidate,
      probability: round(raw / denominator),
    }))
    .sort((a, b) => b.probability - a.probability);
}

export function propagateNogood(
  beliefs: Belief[],
  invalidAssumptionIds: ReadonlySet<string>,
): Belief[] {
  return beliefs.map((belief) => {
    const survivingEnvironments = belief.environments.filter(
      (environment) =>
        ![...invalidAssumptionIds].some((assumptionId) =>
          environment.includes(assumptionId),
        ),
    );
    if (survivingEnvironments.length === belief.environments.length) {
      return { ...belief, survivingEnvironments: structuredClone(survivingEnvironments) };
    }

    const survivalRatio =
      belief.environments.length === 0
        ? 0
        : survivingEnvironments.length / belief.environments.length;
    return {
      ...belief,
      survivingEnvironments,
      confidence: round(belief.confidence * (survivalRatio === 0 ? 0.25 : 0.65)),
      status: survivalRatio === 0 ? 'rejected' : 'weakened',
    };
  });
}

export function investigateAnomaly(
  input: CaseState,
  anomalyId: string,
  timestamp?: string,
): MutationResult {
  const state = structuredClone(input);
  const anomaly = state.anomalies.find((item) => item.id === anomalyId);
  if (!anomaly) throw new Error(`Unknown anomaly: ${anomalyId}`);
  if (anomaly.status !== 'open') {
    return {
      state,
      revision: null,
      auditSteps: ['Investigation was already recorded; no state was changed.'],
    };
  }

  const createdAt = nowOr(timestamp);
  const revisionId = nextRevisionId(state);
  const attemptId = nextObjectId('ATT', state);
  let result: string;
  let usefulEvidenceIds: string[];
  let auditSteps: string[];
  const changes: CaseRevision['changes'] = [];

  if (anomaly.id === 'AN-J') {
    const reference = state.unresolvedReferences.find((item) => item.id === 'U-J');
    if (!reference) throw new Error('The U-J reference is missing from the case state.');
    const previousLead = reference.candidateBindings[0];
    reference.candidateBindings = scoreCandidateBindings(reference);
    const lead = reference.candidateBindings[0];
    if (!lead) throw new Error('The identity resolver returned no candidates.');
    reference.status = 'candidate';
    reference.resolvedBy = attemptId;
    usefulEvidenceIds = reference.resolutionSignals
      .filter((signal) => signal.candidateEntityId === lead.entityId)
      .map((signal) => signal.evidenceId);
    result = `${lead.label} is the leading binding at ${Math.round(lead.probability * 100)}%; the original “J” reference remains unchanged.`;
    auditSteps = [
      `RESOLVER scored ${reference.candidateBindings.length} candidate bindings from explicit priors.`,
      `LINKER applied ${reference.resolutionSignals.filter((signal) => signal.channel === 'social' || signal.channel === 'object').length} social/object signals.`,
      `CHRONOLOGIST applied ${reference.resolutionSignals.filter((signal) => signal.channel === 'temporal').length} temporal signal.`,
      `FALSIFIER retained ${reference.candidateBindings.length - 1} alternatives rather than hard-merging the identity.`,
    ];

    const identityEdge = state.worldEdges.find((edge) => edge.id === 'WE-J-IDENTITY');
    if (identityEdge) {
      identityEdge.confidence = lead.probability;
      identityEdge.transactionTime = createdAt;
      identityEdge.disputed = true;
      identityEdge.sourceObservationIds = [
        ...new Set([...identityEdge.sourceObservationIds, 'O-114-ALIAS', 'O-107-NAMES']),
      ];
    }
    const referenceEntity = state.entities.find((entity) => entity.id === 'E-REF-J');
    if (referenceEntity) referenceEntity.confidence = lead.probability;
    const badgeEdge = state.worldEdges.find((edge) => edge.id === 'WE-JORDAN-BADGE');
    if (badgeEdge) {
      badgeEdge.confidence = round(Math.min(0.82, badgeEdge.confidence + 0.11));
      badgeEdge.transactionTime = createdAt;
    }
    const questionBelief = state.beliefs.find((belief) => belief.id === 'B-U-J');
    if (questionBelief) {
      questionBelief.confidence = lead.probability;
      questionBelief.detail = result;
      questionBelief.status = 'contested';
    }
    const possessionBelief = state.beliefs.find((belief) => belief.id === 'H-31');
    if (possessionBelief) {
      possessionBelief.confidence = round(Math.min(0.8, possessionBelief.confidence + 0.1));
    }
    changes.push({
      id: `${revisionId}-C1`,
      kind: 'reference',
      subjectId: 'U-J',
      label: 'Leading candidate for “J”',
      before: `${previousLead?.label ?? 'Unknown'} ${Math.round((previousLead?.probability ?? 0) * 100)}%`,
      after: `${lead.label} ${Math.round(lead.probability * 100)}%`,
      direction: 'raised',
    });
  } else {
    const returnedEvidenceIds = new Set<string>();
    for (const relatedId of anomaly.relatedIds) {
      const evidenceItem = state.evidence.find((item) => item.id === relatedId);
      if (evidenceItem) returnedEvidenceIds.add(evidenceItem.id);
      const assumption = state.assumptions.find((item) => item.id === relatedId);
      assumption?.sourceEvidenceIds.forEach((id) => returnedEvidenceIds.add(id));
      const reference = state.unresolvedReferences.find((item) => item.id === relatedId);
      reference?.sourceEvidenceIds.forEach((id) => returnedEvidenceIds.add(id));
      const entity = state.entities.find((item) => item.id === relatedId);
      entity?.sourceEvidenceIds.forEach((id) => returnedEvidenceIds.add(id));
    }
    usefulEvidenceIds = [...returnedEvidenceIds];
    result = `Recovered ${usefulEvidenceIds.length} directly linked source${usefulEvidenceIds.length === 1 ? '' : 's'}, but no new evidence establishes a safe resolution.`;
    auditSteps = [
      `CASE PACKET expanded ${anomaly.relatedIds.length} linked case objects.`,
      `EVIDENCE MEMORY returned ${usefulEvidenceIds.length} source artifacts.`,
      'FALSIFIER found no basis for collapsing the remaining alternatives.',
      'INVESTIGATOR left the question unresolved pending new evidence.',
    ];
  }

  anomaly.status = 'investigated';
  anomaly.lastResult = result;
  const allReturned = [
    ...new Set([
      ...usefulEvidenceIds,
      ...anomaly.relatedIds.filter((id) => state.evidence.some((item) => item.id === id)),
    ]),
  ];
  state.proceduralMemory.unshift({
    id: attemptId,
    caseId: state.metadata.id,
    anomalyId: anomaly.id,
    question: anomaly.question,
    strategy: {
      entityExpansion: true,
      temporalFilter: anomaly.category === 'when' || anomaly.id === 'AN-J',
      keywordSearch: true,
      semanticSearch: false,
      graphDepth: 2,
    },
    returnedEvidenceIds: allReturned,
    usefulEvidenceIds,
    result,
    utilityScore:
      anomaly.id === 'AN-J' ? 0.87 : round(Math.max(0.2, usefulEvidenceIds.length / 10)),
    auditSteps,
    createdAt,
  });

  const revision: CaseRevision = {
    id: revisionId,
    caseId: state.metadata.id,
    sequence: state.metadata.revision + 1,
    createdAt,
    title: `Investigated: ${anomaly.question}`,
    summary: result,
    triggerEvidenceId: null,
    changes:
      changes.length > 0
        ? changes
        : [
            {
              id: `${revisionId}-C1`,
              kind: 'belief',
              subjectId: anomaly.id,
              label: 'Anomaly status',
              before: 'Open',
              after: 'Investigated; unresolved pending new evidence',
              direction: 'resolved',
            },
          ],
    trace: [
      {
        id: `${revisionId}-T1`,
        kind: 'evidence',
        label: `${usefulEvidenceIds.length} useful source paths`,
        relation: 'were assembled into a bounded case packet',
      },
      {
        id: `${revisionId}-T2`,
        kind: 'hypothesis',
        label: result,
        relation: 'was stored with alternatives and strategy memory',
      },
    ],
  };
  state.revisions.unshift(revision);
  state.metadata.revision = revision.sequence;
  state.metadata.updatedAt = createdAt;
  return { state, revision, auditSteps };
}

const COUNTER_EVIDENCE_CONTENT =
  'Municipal traffic frame 21:06:14: Vehicle V17 verified at Pier 48 south gate, 1.8 km from Warehouse A.';

export function applyCounterEvidence(input: CaseState, timestamp?: string): MutationResult {
  const state = structuredClone(input);
  if (state.evidence.some((item) => item.id === 'EV-143')) {
    return {
      state,
      revision: null,
      auditSteps: ['Evidence 143 already exists; the mutation is idempotent.'],
    };
  }
  const createdAt = nowOr(timestamp);
  const revisionId = nextRevisionId(state);
  const counterEvidence: EvidenceArtifact = {
    id: 'EV-143',
    caseId: state.metadata.id,
    title: 'Pier 48 traffic camera frame',
    kind: 'image',
    fileName: 'traffic-frame-143.jpg.txt',
    mimeType: 'text/plain',
    sha256: '47dc1fc4e2c5e57d176bf69513cc4cc5d7a63b1d1603bb372f383b9c4cb29607',
    ingestedAt: createdAt,
    capturedAt: {
      earliest: '2026-08-04T21:06:14.000-07:00',
      latest: '2026-08-04T21:06:14.000-07:00',
      precision: 'exact',
      confidence: 0.98,
    },
    sourceLabel: 'Municipal traffic camera / frame 143',
    chainOfCustody: 'Synthetic fixture · second independent camera source',
    content: COUNTER_EVIDENCE_CONTENT,
    rawLocator: null,
    extractionStatus: 'complete',
    extractor: 'authored-fixture',
    observationIds: ['O-143-V17'],
    claimIds: [],
    synthetic: true,
    challengedByEvidenceIds: [],
  };
  const counterObservation: Observation = {
    id: 'O-143-V17',
    caseId: state.metadata.id,
    sourceEvidenceId: 'EV-143',
    kind: 'location',
    text: 'Vehicle V17 is independently verified at Pier 48 south gate at 21:06:14.',
    locator: 'frame 143 / plate region and timestamp overlay',
    extractionConfidence: 0.98,
    interval: counterEvidence.capturedAt,
    entityIds: ['E-VEHICLE17', 'E-PIER48'],
    materialWeight: 15,
  };
  state.evidence.unshift(counterEvidence);
  state.observations.unshift(counterObservation);
  state.evidenceMemory.unshift({
    id: 'ME-EV-143',
    caseId: state.metadata.id,
    kind: 'evidence',
    subjectId: 'EV-143',
    summary:
      'Independent Pier 48 traffic frame adds a high-confidence V17 location observation.',
    sourceIds: ['EV-143', 'O-143-V17'],
    confidence: 0.98,
    revision: state.metadata.revision + 1,
    updatedAt: createdAt,
  });
  const challenged = state.evidence.find((item) => item.id === 'EV-058');
  if (challenged) challenged.challengedByEvidenceIds.push('EV-143');

  const assumption = state.assumptions.find((item) => item.id === 'A-19');
  if (!assumption) throw new Error('Assumption A-19 is missing from the case state.');
  assumption.status = 'invalid';
  assumption.invalidatedByEvidenceId = 'EV-143';
  assumption.sourceEvidenceIds.push('EV-143');
  state.beliefs = propagateNogood(state.beliefs, new Set(['A-19']));

  const affectedEdges = state.worldEdges.filter((edge) =>
    edge.assumptionIds.includes('A-19'),
  );
  const edgeBefore = new Map(affectedEdges.map((edge) => [edge.id, edge.confidence]));
  for (const edge of affectedEdges) {
    edge.confidence = round(edge.confidence * 0.67);
    edge.disputed = true;
    edge.transactionTime = createdAt;
    edge.contributions.push({
      sourceId: 'O-143-V17',
      label: 'V17 independently located at Pier 48',
      weight: 0.53,
      polarity: 'oppose',
    });
  }
  const vehicleWarehouseEdge = state.worldEdges.find(
    (edge) => edge.id === 'WE-VEHICLE-WAREHOUSE',
  );
  if (vehicleWarehouseEdge) vehicleWarehouseEdge.confidence = 0.18;
  const jordanWarehouseEdge = state.worldEdges.find(
    (edge) => edge.id === 'WE-JORDAN-WAREHOUSE',
  );
  if (jordanWarehouseEdge) jordanWarehouseEdge.confidence = 0.52;
  const jordanArrivalEdge = state.worldEdges.find(
    (edge) => edge.id === 'WE-JORDAN-ARRIVAL',
  );
  if (jordanArrivalEdge) jordanArrivalEdge.confidence = 0.49;
  state.worldEdges.push({
    id: 'WE-VEHICLE-PIER48',
    caseId: state.metadata.id,
    subjectId: 'E-VEHICLE17',
    predicate: 'OBSERVED_AT',
    objectId: 'E-PIER48',
    confidence: 0.98,
    sourceClaimIds: [],
    sourceObservationIds: ['O-143-V17'],
    contributions: [
      {
        sourceId: 'O-143-V17',
        label: 'Independent plate and timestamp verification',
        weight: 0.98,
        polarity: 'support',
      },
    ],
    validTime: counterEvidence.capturedAt,
    transactionTime: createdAt,
    disputed: false,
    alternatives: [],
    createdByAgent: 'linker',
    assumptionIds: [],
    lenses: ['objects', 'place', 'time', 'theory'],
  });
  const arrival = state.entities.find((entity) => entity.id === 'E-ARRIVAL91');
  if (arrival) {
    arrival.confidence = 0.52;
    arrival.description =
      'Candidate arrival weakened after V17 was independently located at Pier 48.';
  }
  const pier = state.entities.find((entity) => entity.id === 'E-PIER48');
  if (pier) pier.sourceEvidenceIds.push('EV-143');

  const reconstructionA = state.reconstructions.find((item) => item.id === 'R-A');
  const reconstructionC = state.reconstructions.find((item) => item.id === 'R-C');
  if (!reconstructionA || !reconstructionC) {
    throw new Error('The sample reconstructions are missing from the case state.');
  }
  const beforeA = reconstructionA.coveragePercent;
  const beforeC = reconstructionC.coveragePercent;
  reconstructionA.explainedPoints = 48;
  reconstructionA.coveragePercent = calculateCoverage(
    reconstructionA.explainedPoints,
    reconstructionA.materialPoints,
  );
  reconstructionA.coverageBreakdown = {
    observedDirectly: 29,
    multiSourceSupported: 9,
    inferred: 10,
    unexplained: 52,
  };
  reconstructionA.contradictions = 6;
  reconstructionA.assumptions = 6;
  reconstructionA.isLeading = false;
  reconstructionA.rank = 2;
  reconstructionA.eyebrow = 'Weakened reconstruction';
  reconstructionA.updatedAt = createdAt;
  reconstructionA.statements = reconstructionA.statements.map((statement) =>
    statement.id === 'RS-A-3'
      ? {
          ...statement,
          status: 'DISPUTED',
          text: 'Vehicle V17 arrives at Warehouse A; new evidence places it at Pier 48 instead.',
          sourceIds: [...statement.sourceIds, 'O-143-V17'],
        }
      : statement,
  );
  reconstructionC.explainedPoints = 73;
  reconstructionC.coveragePercent = calculateCoverage(
    reconstructionC.explainedPoints,
    reconstructionC.materialPoints,
  );
  reconstructionC.coverageBreakdown = {
    observedDirectly: 33,
    multiSourceSupported: 25,
    inferred: 15,
    unexplained: 27,
  };
  reconstructionC.contradictions = 1;
  reconstructionC.assumptions = 8;
  reconstructionC.isLeading = true;
  reconstructionC.rank = 1;
  reconstructionC.eyebrow = 'Most supported explanation';
  reconstructionC.updatedAt = createdAt;
  reconstructionC.statements = reconstructionC.statements.map((statement) => {
    if (statement.id === 'RS-C-1') {
      return { ...statement, status: 'PARTIALLY_SUPPORTED' };
    }
    if (statement.id === 'RS-C-3') {
      return {
        ...statement,
        status: 'PARTIALLY_SUPPORTED',
        sourceIds: [...statement.sourceIds, 'O-143-V17'],
      };
    }
    return statement;
  });
  const beliefA = state.beliefs.find((belief) => belief.id === 'B-R-A');
  if (beliefA) {
    beliefA.confidence = 0.48;
    beliefA.status = 'weakened';
  }
  const beliefC = state.beliefs.find((belief) => belief.id === 'B-R-C');
  if (beliefC) {
    beliefC.confidence = 0.73;
    beliefC.status = 'supported';
  }
  const alt = state.beliefs.find((belief) => belief.id === 'B-ALT-C');
  if (alt) {
    alt.confidence = 0.73;
    alt.status = 'supported';
    alt.sourceIds.push('O-143-V17');
  }
  state.worldMemory.unshift({
    id: `MW-V17-${state.metadata.revision + 1}`,
    caseId: state.metadata.id,
    kind: 'world',
    subjectId: 'E-VEHICLE17',
    summary:
      'V17 is independently observed at Pier 48 at 21:06:14; its association with the warehouse arrival is now disputed.',
    sourceIds: ['O-143-V17', 'WE-VEHICLE-PIER48'],
    confidence: 0.98,
    revision: state.metadata.revision + 1,
    updatedAt: createdAt,
  });
  state.beliefMemory.unshift(
    ...state.reconstructions.map((reconstruction) => ({
      id: `MB-${reconstruction.id}-${state.metadata.revision + 1}`,
      caseId: state.metadata.id,
      kind: 'belief' as const,
      subjectId: reconstruction.id,
      summary: `${reconstruction.title} recalculated to ${reconstruction.coveragePercent}% coverage after EV-143.`,
      sourceIds: ['EV-143', ...reconstruction.hypothesisIds],
      confidence: reconstruction.coveragePercent / 100,
      revision: state.metadata.revision + 1,
      updatedAt: createdAt,
    })),
  );

  const revision: CaseRevision = {
    id: revisionId,
    caseId: state.metadata.id,
    sequence: state.metadata.revision + 1,
    createdAt,
    title: 'Evidence 143 changed the leading reconstruction',
    summary:
      'V17 was independently located at Pier 48 at 21:06, invalidating the camera-vehicle match assumption.',
    triggerEvidenceId: 'EV-143',
    changes: [
      {
        id: `${revisionId}-C1`,
        kind: 'evidence',
        subjectId: 'EV-143',
        label: 'Pier 48 traffic frame',
        before: null,
        after: 'Added with SHA-256 and source locator',
        direction: 'added',
      },
      {
        id: `${revisionId}-C2`,
        kind: 'assumption',
        subjectId: 'A-19',
        label: 'Camera 4 sedan is V17',
        before: 'Valid',
        after: 'Invalid',
        direction: 'invalidated',
      },
      {
        id: `${revisionId}-C3`,
        kind: 'edge',
        subjectId: 'WE-VEHICLE-WAREHOUSE',
        label: 'V17 observed at Warehouse A',
        before: `${Math.round((edgeBefore.get('WE-VEHICLE-WAREHOUSE') ?? 0) * 100)}%`,
        after: '18%',
        direction: 'lowered',
      },
      {
        id: `${revisionId}-C4`,
        kind: 'reconstruction',
        subjectId: 'R-A',
        label: 'Reconstruction A coverage',
        before: `${beforeA}%`,
        after: `${reconstructionA.coveragePercent}%`,
        direction: 'lowered',
      },
      {
        id: `${revisionId}-C5`,
        kind: 'reconstruction',
        subjectId: 'R-C',
        label: 'Reconstruction C coverage',
        before: `${beforeC}%`,
        after: `${reconstructionC.coveragePercent}%`,
        direction: 'raised',
      },
    ],
    trace: [
      {
        id: `${revisionId}-T1`,
        kind: 'evidence',
        label: 'Evidence 143 · V17 at Pier 48, 21:06',
        relation: 'contradicts',
      },
      {
        id: `${revisionId}-T2`,
        kind: 'assumption',
        label: 'A-19 · Camera 4 sedan is V17',
        relation: 'invalidates',
      },
      {
        id: `${revisionId}-T3`,
        kind: 'event',
        label: 'E91 · Warehouse arrival',
        relation: 'weakens',
      },
      {
        id: `${revisionId}-T4`,
        kind: 'hypothesis',
        label: 'H-08 · Jordan arrived in V17',
        relation: 'removes its only ATMS environment',
      },
      {
        id: `${revisionId}-T5`,
        kind: 'reconstruction',
        label: 'Reconstruction A · 81% → 48%',
        relation: 'changes the leading account to Reconstruction C at 73%',
      },
    ],
  };
  state.revisions.unshift(revision);
  state.metadata.revision = revision.sequence;
  state.metadata.updatedAt = createdAt;
  return {
    state,
    revision,
    auditSteps: [
      'INGESTOR preserved Evidence 143 and created one typed location observation.',
      'LINKER found the affected V17 location edges.',
      'ATMS marked A-19 as a nogood and removed dependent belief environments.',
      `CHRONOLOGIST reduced ${affectedEdges.length} assumption-bound relationships.`,
      'HYPOTHESIS ENGINE recomputed weighted coverage and changed the leading account.',
    ],
  };
}

export interface LocalIngestionInput {
  title: string;
  fileName: string;
  mimeType: string;
  kind: EvidenceKind;
  sha256: string;
  content: string | null;
  rawLocator: string | null;
  sourceLabel: string;
  sourceReliability: SourceReliability;
  informationCredibility: InformationCredibility;
  extractionStatus?: EvidenceArtifact['extractionStatus'];
  extractor?: EvidenceArtifact['extractor'];
  externalObservations?: Array<{
    kind: Observation['kind'];
    text: string;
    locator: string;
    extractionConfidence: number;
    entityIds?: string[];
    materialWeight?: number;
  }>;
  timestamp?: string;
}

const HEDGE_TERMS = [
  'i think',
  'maybe',
  'probably',
  'pretty sure',
  'around',
  'approximately',
  'not sure',
];

const VAGUE_REFERENCES: Array<{ pattern: RegExp; surface: string; kind: string }> = [
  { pattern: /\bthere\b/i, surface: 'there', kind: 'location' },
  { pattern: /\bthe thing\b/i, surface: 'the thing', kind: 'object' },
  { pattern: /\bthe package\b/i, surface: 'the package', kind: 'object' },
  { pattern: /\bsomeone\b/i, surface: 'someone', kind: 'person' },
  { pattern: /\bunknown person\b/i, surface: 'unknown person', kind: 'person' },
];

function makeLocalObservation(
  id: string,
  caseId: string,
  evidenceId: string,
  text: string,
  locator: string,
  kind: Observation['kind'] = 'text',
): Observation {
  return {
    id,
    caseId,
    sourceEvidenceId: evidenceId,
    kind,
    text,
    locator,
    extractionConfidence: 1,
    interval: null,
    entityIds: [],
    materialWeight: 1,
  };
}

export function ingestLocalEvidence(
  inputState: CaseState,
  input: LocalIngestionInput,
): MutationResult {
  const state = structuredClone(inputState);
  const duplicate = state.evidence.find((item) => item.sha256 === input.sha256);
  if (duplicate) {
    return {
      state,
      revision: null,
      auditSteps: [
        `Duplicate content matched immutable artifact ${duplicate.id}; nothing was rewritten.`,
      ],
    };
  }
  const createdAt = nowOr(input.timestamp);
  const revisionId = nextRevisionId(state);
  const sequence = state.evidence.length + 1;
  const evidenceId = `EV-U${String(sequence).padStart(3, '0')}`;
  const content = input.content?.trim() || null;
  const lines = content
    ? content
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 50)
    : [];
  const newObservations: Observation[] = [];
  const newClaims: Claim[] = [];
  const newReferences: UnresolvedReference[] = [];

  if (input.externalObservations?.length) {
    input.externalObservations.forEach((observation, index) => {
      newObservations.push({
        id: `${evidenceId}-O${index + 1}`,
        caseId: state.metadata.id,
        sourceEvidenceId: evidenceId,
        kind: observation.kind,
        text: observation.text,
        locator: observation.locator,
        extractionConfidence: observation.extractionConfidence,
        interval: null,
        entityIds: observation.entityIds ?? [],
        materialWeight: observation.materialWeight ?? 1,
      });
    });
  }

  if (content) {
    if (!input.externalObservations?.length) {
      newObservations.push(
        makeLocalObservation(
          `${evidenceId}-O1`,
          state.metadata.id,
          evidenceId,
          `Text decoded without semantic rewriting (${lines.length} non-empty line${lines.length === 1 ? '' : 's'}).`,
          'entire decoded file',
        ),
      );
    }
    lines.forEach((line, index) => {
      const match = /^(?:\d{1,2}:\d{2}\s+)?([^:]{1,48}):\s*(.+)$/u.exec(line);
      const speaker = match?.[1]?.trim() ?? null;
      const verbatim = match?.[2]?.trim() ?? line;
      const hedges = HEDGE_TERMS.filter((term) => verbatim.toLowerCase().includes(term));
      const unresolvedReferenceIds: string[] = [];
      for (const vague of VAGUE_REFERENCES) {
        if (!vague.pattern.test(verbatim)) continue;
        const referenceId = `${evidenceId}-U${newReferences.length + 1}`;
        unresolvedReferenceIds.push(referenceId);
        newReferences.push({
          id: referenceId,
          caseId: state.metadata.id,
          surfaceForm: vague.surface,
          context: `“${verbatim.slice(0, 160)}”`,
          kindProbabilities: { [vague.kind]: 0.8, other: 0.2 },
          candidateBindings: [
            {
              entityId: null,
              label: `Unresolved ${vague.kind}`,
              probability: 1,
              prior: 1,
              signalIds: [],
            },
          ],
          resolutionSignals: [],
          status: 'open',
          resolvedBy: null,
          sourceEvidenceIds: [evidenceId],
        });
      }
      newClaims.push({
        id: `${evidenceId}-C${index + 1}`,
        caseId: state.metadata.id,
        sourceEvidenceId: evidenceId,
        speaker,
        proposition: speaker
          ? `${speaker} states: ${verbatim}`
          : `The artifact contains the statement: ${verbatim}`,
        verbatim,
        extractionConfidence: 1,
        sourceReliability: input.sourceReliability,
        informationCredibility: input.informationCredibility,
        hedges,
        interval: null,
        unresolvedReferenceIds,
      });
    });
  } else if (!input.externalObservations?.length) {
    newObservations.push(
      makeLocalObservation(
        `${evidenceId}-O1`,
        state.metadata.id,
        evidenceId,
        `Binary ${input.mimeType || 'file'} retained without interpretation; a configured multimodal extractor is required.`,
        'entire file',
        'unprocessed-media',
      ),
    );
  }

  const artifact: EvidenceArtifact = {
    id: evidenceId,
    caseId: state.metadata.id,
    title: input.title,
    kind: input.kind,
    fileName: input.fileName,
    mimeType: input.mimeType,
    sha256: input.sha256,
    ingestedAt: createdAt,
    capturedAt: null,
    sourceLabel: input.sourceLabel,
    chainOfCustody: 'User-provided local upload · SHA-256 computed on receipt',
    content,
    rawLocator: input.rawLocator,
    extractionStatus:
      input.extractionStatus ??
      (content || input.externalObservations?.length
        ? 'bounded-local'
        : 'requires-adapter'),
    extractor: input.extractor ?? 'local-deterministic',
    observationIds: newObservations.map((item) => item.id),
    claimIds: newClaims.map((item) => item.id),
    synthetic: false,
    challengedByEvidenceIds: [],
  };
  state.evidence.unshift(artifact);
  state.observations.unshift(...newObservations);
  state.claims.unshift(...newClaims);
  state.unresolvedReferences.unshift(...newReferences);
  state.evidenceMemory.unshift({
    id: `ME-${evidenceId}`,
    caseId: state.metadata.id,
    kind: 'evidence',
    subjectId: evidenceId,
    summary: `${artifact.title} · ${newObservations.length} typed observation${newObservations.length === 1 ? '' : 's'} · ${newClaims.length} quoted claim${newClaims.length === 1 ? '' : 's'}`,
    sourceIds: [evidenceId],
    confidence: 1,
    revision: state.metadata.revision + 1,
    updatedAt: createdAt,
  });
  const revision: CaseRevision = {
    id: revisionId,
    caseId: state.metadata.id,
    sequence: state.metadata.revision + 1,
    createdAt,
    title: `Ingested ${artifact.title}`,
    summary: content
      ? `Preserved one artifact, ${newObservations.length} observation, and ${newClaims.length} source-bound claim${newClaims.length === 1 ? '' : 's'} without asserting a world fact.`
      : 'Preserved the binary artifact without inventing a multimodal interpretation.',
    triggerEvidenceId: evidenceId,
    changes: [
      {
        id: `${revisionId}-C1`,
        kind: 'evidence',
        subjectId: evidenceId,
        label: artifact.title,
        before: null,
        after: `${artifact.extractionStatus} · ${artifact.sha256.slice(0, 12)}…`,
        direction: 'added',
      },
    ],
    trace: [
      {
        id: `${revisionId}-T1`,
        kind: 'evidence',
        label: `${artifact.id} · ${artifact.fileName}`,
        relation: content
          ? 'produced bounded text claims; no world relationship was asserted'
          : 'was retained for a future configured multimodal extractor',
      },
    ],
  };
  state.revisions.unshift(revision);
  state.metadata.revision = revision.sequence;
  state.metadata.updatedAt = createdAt;
  return {
    state,
    revision,
    auditSteps: [
      `INGESTOR computed and stored SHA-256 ${input.sha256.slice(0, 12)}….`,
      content
        ? `LOCAL PARSER preserved ${newClaims.length} line-level claim${newClaims.length === 1 ? '' : 's'} verbatim.`
        : 'LOCAL PARSER refused to describe unsupported binary media.',
      `${newReferences.length} vague reference${newReferences.length === 1 ? ' was' : 's were'} retained unresolved.`,
      'No entity merge, event, or world edge was created automatically.',
    ],
  };
}

export type AllenRelation =
  | 'before'
  | 'meets'
  | 'overlaps'
  | 'starts'
  | 'during'
  | 'finishes'
  | 'equals'
  | 'finished-by'
  | 'contains'
  | 'started-by'
  | 'overlapped-by'
  | 'met-by'
  | 'after';

export function allenRelation(a: TimeInterval, b: TimeInterval): AllenRelation {
  const aStart = Date.parse(a.earliest);
  const aEnd = Date.parse(a.latest);
  const bStart = Date.parse(b.earliest);
  const bEnd = Date.parse(b.latest);
  if ([aStart, aEnd, bStart, bEnd].some(Number.isNaN)) {
    throw new Error('Allen interval comparison requires valid ISO-8601 timestamps.');
  }
  if (aEnd < bStart) return 'before';
  if (aEnd === bStart) return 'meets';
  if (aStart < bStart && aEnd > bStart && aEnd < bEnd) return 'overlaps';
  if (aStart === bStart && aEnd < bEnd) return 'starts';
  if (aStart > bStart && aEnd < bEnd) return 'during';
  if (aStart > bStart && aEnd === bEnd) return 'finishes';
  if (aStart === bStart && aEnd === bEnd) return 'equals';
  if (aStart < bStart && aEnd === bEnd) return 'finished-by';
  if (aStart < bStart && aEnd > bEnd) return 'contains';
  if (aStart === bStart && aEnd > bEnd) return 'started-by';
  if (aStart > bStart && aStart < bEnd && aEnd > bEnd) return 'overlapped-by';
  if (aStart === bEnd) return 'met-by';
  return 'after';
}

const allenRelations: AllenRelation[] = [
  'before',
  'meets',
  'overlaps',
  'starts',
  'during',
  'finishes',
  'equals',
  'finished-by',
  'contains',
  'started-by',
  'overlapped-by',
  'met-by',
  'after',
];

const inverseAllenRelation: Record<AllenRelation, AllenRelation> = {
  before: 'after',
  meets: 'met-by',
  overlaps: 'overlapped-by',
  starts: 'started-by',
  during: 'contains',
  finishes: 'finished-by',
  equals: 'equals',
  'finished-by': 'finishes',
  contains: 'during',
  'started-by': 'starts',
  'overlapped-by': 'overlaps',
  'met-by': 'meets',
  after: 'before',
};

function numericAllenRelation(
  a: readonly [number, number],
  b: readonly [number, number],
): AllenRelation {
  const [aStart, aEnd] = a;
  const [bStart, bEnd] = b;
  if (aEnd < bStart) return 'before';
  if (aEnd === bStart) return 'meets';
  if (aStart < bStart && aEnd > bStart && aEnd < bEnd) return 'overlaps';
  if (aStart === bStart && aEnd < bEnd) return 'starts';
  if (aStart > bStart && aEnd < bEnd) return 'during';
  if (aStart > bStart && aEnd === bEnd) return 'finishes';
  if (aStart === bStart && aEnd === bEnd) return 'equals';
  if (aStart < bStart && aEnd === bEnd) return 'finished-by';
  if (aStart < bStart && aEnd > bEnd) return 'contains';
  if (aStart === bStart && aEnd > bEnd) return 'started-by';
  if (aStart > bStart && aStart < bEnd && aEnd > bEnd) return 'overlapped-by';
  if (aStart === bEnd) return 'met-by';
  return 'after';
}

let allenCompositionTable: Map<string, ReadonlySet<AllenRelation>> | undefined;

function compositionTable(): Map<string, ReadonlySet<AllenRelation>> {
  if (allenCompositionTable) return allenCompositionTable;
  const intervals: Array<readonly [number, number]> = [];
  // A finite endpoint model over nine ordered points realizes every ordering
  // required by Allen's 13-relation composition table.
  for (let start = 0; start < 8; start += 1) {
    for (let end = start + 1; end < 9; end += 1) intervals.push([start, end]);
  }
  const mutable = new Map<string, Set<AllenRelation>>();
  for (const a of intervals) {
    for (const b of intervals) {
      const left = numericAllenRelation(a, b);
      for (const c of intervals) {
        const right = numericAllenRelation(b, c);
        const key = `${left}|${right}`;
        const relations = mutable.get(key) ?? new Set<AllenRelation>();
        relations.add(numericAllenRelation(a, c));
        mutable.set(key, relations);
      }
    }
  }
  allenCompositionTable = mutable;
  return allenCompositionTable;
}

function intersectRelations(
  left: ReadonlySet<AllenRelation>,
  right: ReadonlySet<AllenRelation>,
): Set<AllenRelation> {
  return new Set([...left].filter((relation) => right.has(relation)));
}

function composeRelations(
  left: ReadonlySet<AllenRelation>,
  right: ReadonlySet<AllenRelation>,
): Set<AllenRelation> {
  const table = compositionTable();
  const result = new Set<AllenRelation>();
  for (const a of left) {
    for (const b of right) {
      for (const relation of table.get(`${a}|${b}`) ?? []) result.add(relation);
    }
  }
  return result;
}

export interface TemporalConsistencyResult {
  consistent: boolean;
  constraints: TemporalConstraint[];
  contradictions: string[];
  inferredRelations: Record<string, AllenRelation[]>;
}

export function enforceTemporalPathConsistency(
  input: TemporalConstraint[],
): TemporalConsistencyResult {
  const constraints = structuredClone(input);
  const nodes = [
    ...new Set(
      constraints.flatMap((constraint) => [
        constraint.sourceEventId,
        constraint.targetEventId,
      ]),
    ),
  ];
  const universal = new Set(allenRelations);
  const relationMap = new Map<string, Set<AllenRelation>>();
  const keyFor = (source: string, target: string) => `${source}\u0000${target}`;
  for (const source of nodes) {
    for (const target of nodes) {
      relationMap.set(
        keyFor(source, target),
        source === target ? new Set(['equals']) : new Set(universal),
      );
    }
  }
  for (const constraint of constraints) {
    const forwardKey = keyFor(constraint.sourceEventId, constraint.targetEventId);
    const reverseKey = keyFor(constraint.targetEventId, constraint.sourceEventId);
    const allowed = new Set(constraint.possibleRelations);
    relationMap.set(
      forwardKey,
      intersectRelations(relationMap.get(forwardKey) ?? universal, allowed),
    );
    relationMap.set(
      reverseKey,
      new Set(
        [...(relationMap.get(forwardKey) ?? [])].map(
          (relation) => inverseAllenRelation[relation],
        ),
      ),
    );
  }

  const contradictions = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const via of nodes) {
      for (const source of nodes) {
        for (const target of nodes) {
          const directKey = keyFor(source, target);
          const direct = relationMap.get(directKey) ?? universal;
          const through = composeRelations(
            relationMap.get(keyFor(source, via)) ?? universal,
            relationMap.get(keyFor(via, target)) ?? universal,
          );
          const narrowed = intersectRelations(direct, through);
          if (narrowed.size === 0) {
            contradictions.add(`${source} → ${target} is inconsistent through ${via}`);
          }
          if (narrowed.size < direct.size) {
            relationMap.set(directKey, narrowed);
            relationMap.set(
              keyFor(target, source),
              new Set([...narrowed].map((relation) => inverseAllenRelation[relation])),
            );
            changed = true;
          }
        }
      }
    }
  }
  for (const constraint of constraints) {
    const narrowed = [
      ...(relationMap.get(keyFor(constraint.sourceEventId, constraint.targetEventId)) ??
        []),
    ];
    constraint.possibleRelations = narrowed;
    constraint.status = narrowed.length === 0 ? 'inconsistent' : 'consistent';
  }
  return {
    consistent: contradictions.size === 0,
    constraints,
    contradictions: [...contradictions],
    inferredRelations: Object.fromEntries(
      [...relationMap].map(([key, relations]) => [
        key.replace('\u0000', ' → '),
        [...relations],
      ]),
    ),
  };
}

export function shannonEntropy(probabilities: number[]): number {
  const total = probabilities.reduce((sum, probability) => sum + probability, 0);
  if (total <= 0) return 0;
  return round(
    probabilities.reduce((entropy, probability) => {
      if (probability <= 0) return entropy;
      const normalized = probability / total;
      return entropy - normalized * Math.log2(normalized);
    }, 0),
    4,
  );
}

export interface CandidateQuestion {
  id: string;
  question: string;
  answers: Array<{
    label: string;
    probability: number;
    posteriorHypothesisProbabilities: number[];
  }>;
}

export interface RankedQuestion extends CandidateQuestion {
  priorEntropy: number;
  expectedPosteriorEntropy: number;
  expectedInformationGain: number;
}

export function rankQuestionsByInformationGain(
  priorHypothesisProbabilities: number[],
  questions: CandidateQuestion[],
): RankedQuestion[] {
  const priorEntropy = shannonEntropy(priorHypothesisProbabilities);
  return questions
    .map((question) => {
      const answerTotal = question.answers.reduce(
        (sum, answer) => sum + answer.probability,
        0,
      );
      const expectedPosteriorEntropy =
        answerTotal <= 0
          ? priorEntropy
          : question.answers.reduce(
              (sum, answer) =>
                sum +
                (answer.probability / answerTotal) *
                  shannonEntropy(answer.posteriorHypothesisProbabilities),
              0,
            );
      return {
        ...question,
        priorEntropy,
        expectedPosteriorEntropy: round(expectedPosteriorEntropy, 4),
        expectedInformationGain: round(
          Math.max(0, priorEntropy - expectedPosteriorEntropy),
          4,
        ),
      };
    })
    .sort((left, right) => right.expectedInformationGain - left.expectedInformationGain);
}

const sourceReliabilityScale: Record<SourceReliability, number> = {
  A: 0.95,
  B: 0.82,
  C: 0.68,
  D: 0.45,
  E: 0.2,
  F: 0.5,
};

const informationCredibilityScale: Record<InformationCredibility, number> = {
  1: 0.95,
  2: 0.8,
  3: 0.65,
  4: 0.45,
  5: 0.2,
  6: 0.5,
};

export function admiraltyStrength(
  sourceReliability: SourceReliability,
  informationCredibility: InformationCredibility,
): {
  sourceReliability: number;
  informationCredibility: number;
  combinedStrength: number;
} {
  const reliability = sourceReliabilityScale[sourceReliability];
  const credibility = informationCredibilityScale[informationCredibility];
  return {
    sourceReliability: reliability,
    informationCredibility: credibility,
    combinedStrength: round(Math.sqrt(reliability * credibility), 3),
  };
}

export interface CoveragePoint {
  id: string;
  weight: number;
  support: 'direct' | 'multi-source' | 'inferred' | 'unexplained';
}

export function computeWeightedCoverage(points: CoveragePoint[]): {
  materialPoints: number;
  explainedPoints: number;
  coveragePercent: number;
  breakdown: {
    observedDirectly: number;
    multiSourceSupported: number;
    inferred: number;
    unexplained: number;
  };
} {
  const materialPoints = points.reduce((sum, point) => sum + Math.max(0, point.weight), 0);
  const weights = (support: CoveragePoint['support']) =>
    points
      .filter((point) => point.support === support)
      .reduce((sum, point) => sum + Math.max(0, point.weight), 0);
  const unexplained = weights('unexplained');
  const explainedPoints = materialPoints - unexplained;
  const percentage = (value: number) =>
    materialPoints <= 0 ? 0 : Math.round((value / materialPoints) * 100);
  return {
    materialPoints: round(materialPoints),
    explainedPoints: round(explainedPoints),
    coveragePercent: calculateCoverage(explainedPoints, materialPoints),
    breakdown: {
      observedDirectly: percentage(weights('direct')),
      multiSourceSupported: percentage(weights('multi-source')),
      inferred: percentage(weights('inferred')),
      unexplained: percentage(unexplained),
    },
  };
}
