import type {
  CasePacket,
  CaseResearchSession,
  CaseState,
  ResearchCorrection,
  ResearchFinding,
  ResearchNegativeFinding,
  ResearchScope,
  ResearchSurfaceCheck,
} from '@thread/domain';
import type { ConnectedResearchOutput } from './connected-research.js';
import type { FalsifierReview, HypothesisReview } from './providers.js';

export interface ReviewBundle {
  hypothesis: HypothesisReview;
  falsifier: FalsifierReview;
  hypothesisModel: string;
  falsifierModel: string;
}

interface BuildResearchSessionInput {
  state: CaseState;
  packet: CasePacket;
  scope: ResearchScope;
  sessionId: string;
  runId: string;
  startedAt: string;
  completedAt: string;
  review: ReviewBundle | null;
  connected: ConnectedResearchOutput | null;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function caseObjectIds(state: CaseState): Set<string> {
  return new Set([
    ...state.evidence.map((item) => item.id),
    ...state.observations.map((item) => item.id),
    ...state.claims.map((item) => item.id),
    ...state.entities.map((item) => item.id),
    ...state.worldEdges.map((item) => item.id),
    ...state.unresolvedReferences.map((item) => item.id),
    ...state.assumptions.map((item) => item.id),
    ...state.beliefs.map((item) => item.id),
    ...state.beliefEdges.map((item) => item.id),
    ...state.reconstructions.map((item) => item.id),
    ...state.anomalies.map((item) => item.id),
  ]);
}

function caseSurfaces(
  state: CaseState,
  packet: CasePacket,
  sessionId: string,
): ResearchSurfaceCheck[] {
  const temporal = state.observations.filter(
    (item) => packet.observationIds.includes(item.id) && item.interval,
  );
  return [
    {
      id: `${sessionId}-SURFACE-MEMORY`,
      label: 'Case memory',
      surface: 'case-memory',
      status: packet.previousAttemptIds.length > 0 ? 'found' : 'checked-empty',
      detail:
        packet.previousAttemptIds.length > 0
          ? `Recovered ${packet.previousAttemptIds.length} useful prior investigation ${packet.previousAttemptIds.length === 1 ? 'attempt' : 'attempts'} before searching again.`
          : 'No prior investigation attempt matched closely enough to reuse.',
      locator: null,
      sourceId: packet.previousAttemptIds[0] ?? null,
    },
    {
      id: `${sessionId}-SURFACE-EVIDENCE`,
      label:
        packet.retrievalMethod === 'atlas-rank-fusion'
          ? 'Atlas hybrid evidence search'
          : 'Bounded case search',
      surface: 'case-evidence',
      status: packet.observationIds.length > 0 ? 'found' : 'checked-empty',
      detail: `${packet.exactMatchIds.length} exact and ${packet.semanticMatchIds.length} semantic matches produced ${packet.evidenceIds.length} source artifacts.`,
      locator: null,
      sourceId: packet.evidenceIds[0] ?? null,
    },
    {
      id: `${sessionId}-SURFACE-GRAPH`,
      label: 'Relationship orbit',
      surface: 'case-graph',
      status: packet.graphNeighborIds.length > 0 ? 'found' : 'checked-empty',
      detail:
        packet.graphNeighborIds.length > 0
          ? `Expanded ${packet.graphNeighborIds.length} graph neighbors around the retrieved entities.`
          : 'No provenance-bound graph neighbor was found inside the selected depth.',
      locator: null,
      sourceId: packet.graphNeighborIds[0] ?? null,
    },
    {
      id: `${sessionId}-SURFACE-TIME`,
      label: 'Timeline constraints',
      surface: 'case-timeline',
      status: temporal.length > 0 ? 'found' : 'checked-empty',
      detail:
        temporal.length > 0
          ? `Compared ${temporal.length} retrieved observations with explicit or fuzzy time intervals.`
          : 'The retrieved observations contain no source-bound time interval.',
      locator: null,
      sourceId: temporal[0]?.id ?? null,
    },
  ];
}

function revisionCorrections(
  state: CaseState,
  packet: CasePacket,
  sessionId: string,
): ResearchCorrection[] {
  const packetIds = new Set([
    ...packet.evidenceIds,
    ...packet.observationIds,
    ...packet.graphNeighborIds,
  ]);
  const relevant = state.revisions
    .flatMap((revision) => revision.changes.map((change) => ({ revision, change })))
    .filter(
      ({ revision, change }) =>
        change.before &&
        change.after &&
        ['lowered', 'invalidated', 'resolved'].includes(change.direction) &&
        (packetIds.has(change.subjectId) ||
          Boolean(revision.triggerEvidenceId && packetIds.has(revision.triggerEvidenceId))),
    )
    .slice(-3);
  return relevant.map(({ revision, change }, index) => ({
    id: `${sessionId}-CORRECTION-${index + 1}`,
    prior: `${change.label}: ${change.before}`,
    corrected: `${change.label}: ${change.after}`,
    reason: revision.summary,
    sourceIds: revision.triggerEvidenceId ? [revision.triggerEvidenceId] : [],
  }));
}

function caseNegativeFindings(
  state: CaseState,
  packet: CasePacket,
  sessionId: string,
  surfaceChecks: ResearchSurfaceCheck[],
): ResearchNegativeFinding[] {
  const evidenceSurfaceId = surfaceChecks.find(
    (item) => item.surface === 'case-evidence',
  )?.id;
  const unresolved = state.unresolvedReferences
    .filter(
      (item) =>
        item.status !== 'resolved' &&
        item.sourceEvidenceIds.some((id) => packet.evidenceIds.includes(id)),
    )
    .slice(0, 3)
    .map((item, index) => ({
      id: `${sessionId}-NEGATIVE-REF-${index + 1}`,
      label: `Not established: ${item.surfaceForm}`,
      detail: `${item.context} remains ${item.status}; the search did not hard-merge a candidate for convenience.`,
      surfaceCheckIds: evidenceSurfaceId ? [evidenceSurfaceId] : [],
    }));
  const rejected = state.beliefs
    .filter(
      (item) =>
        (item.status === 'rejected' || item.status === 'weakened') &&
        item.sourceIds.some(
          (id) =>
            packet.evidenceIds.includes(id) ||
            packet.observationIds.includes(id) ||
            packet.graphNeighborIds.includes(id),
        ),
    )
    .slice(0, 2)
    .map((item, index) => ({
      id: `${sessionId}-NEGATIVE-BELIEF-${index + 1}`,
      label: `Account did not survive: ${item.label}`,
      detail: item.detail,
      surfaceCheckIds: evidenceSurfaceId ? [evidenceSurfaceId] : [],
    }));
  if (unresolved.length + rejected.length > 0) return [...unresolved, ...rejected];
  return [
    {
      id: `${sessionId}-NEGATIVE-BOUNDARY`,
      label: 'No direct closure in this packet',
      detail: `The bounded search returned ${packet.observationIds.length} observations, but none independently closes every open assumption.`,
      surfaceCheckIds: evidenceSurfaceId ? [evidenceSurfaceId] : [],
    },
  ];
}

function deterministicAnswer(state: CaseState, packet: CasePacket): string {
  const leading =
    state.reconstructions.find((item) => item.isLeading) ?? state.reconstructions[0];
  const diagnostic = packet.observationIds
    .map((id) => state.observations.find((item) => item.id === id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => b.materialWeight - a.materialWeight)[0];
  if (!diagnostic) {
    return `The bounded search for “${packet.question}” returned no source-bound observation. No answer or new case fact was created.`;
  }
  const leadingClause = leading
    ? ` The current account with the broadest weighted coverage is ${leading.title} (${leading.coveragePercent}%): ${leading.summary}`
    : ' No reconstruction exists yet, so the retrieved observation was not turned into an explanatory account.';
  return `THREAD retrieved ${packet.observationIds.length} observations from ${packet.evidenceIds.length} preserved artifacts for “${packet.question}”. The most diagnostic returned observation is: ${diagnostic.text}${leadingClause}`;
}

function localFindings(
  state: CaseState,
  packet: CasePacket,
  sessionId: string,
  review: ReviewBundle | null,
  surfaceChecks: ResearchSurfaceCheck[],
): ResearchFinding[] {
  const known = caseObjectIds(state);
  const evidenceSurfaceId = surfaceChecks.find(
    (item) => item.surface === 'case-evidence',
  )?.id;
  const graphSurfaceId = surfaceChecks.find((item) => item.surface === 'case-graph')?.id;
  const leading =
    state.reconstructions.find((item) => item.isLeading) ?? state.reconstructions[0];
  const alternative = review
    ? state.reconstructions.find(
        (item) => item.id === review.falsifier.alternative_reconstruction_id,
      )
    : state.reconstructions.find((item) => !item.isLeading);
  const diagnosticIds = review
    ? review.hypothesis.diagnostic_evidence_ids.filter((id) => known.has(id))
    : packet.observationIds.slice(0, 4);
  const contradictingIds = review
    ? review.falsifier.contradicting_ids.filter((id) => known.has(id))
    : unique(
        state.worldEdges
          .filter((item) => item.disputed)
          .flatMap((item) => [...item.sourceObservationIds, ...item.sourceClaimIds]),
      ).slice(0, 4);
  const findings: ResearchFinding[] = [];
  if (leading) {
    findings.push({
      id: `${sessionId}-FINDING-LEAD`,
      label: leading.title,
      detail: review?.hypothesis.summary ?? leading.summary,
      status: leading.contradictions > 0 ? 'lead' : 'supported',
      confidence: clamp(leading.coveragePercent / 100),
      sourceIds: unique([leading.id, ...diagnosticIds]),
      surfaceCheckIds: unique(
        [evidenceSurfaceId, graphSurfaceId].filter((id): id is string => Boolean(id)),
      ),
    });
  }
  if (review || alternative) {
    findings.push({
      id: `${sessionId}-FINDING-CHALLENGE`,
      label: 'Strongest challenge',
      detail:
        review?.falsifier.strongest_counterargument ??
        alternative?.summary ??
        'No alternative account was available to test.',
      status: 'disputed',
      confidence: alternative ? clamp(alternative.coveragePercent / 100) : 0.5,
      sourceIds: unique([...(alternative ? [alternative.id] : []), ...contradictingIds]),
      surfaceCheckIds: evidenceSurfaceId ? [evidenceSurfaceId] : [],
    });
  }
  const strongestObservation = packet.observationIds
    .map((id) => state.observations.find((item) => item.id === id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => b.materialWeight - a.materialWeight)[0];
  if (strongestObservation) {
    findings.push({
      id: `${sessionId}-FINDING-DIAGNOSTIC`,
      label: 'Most diagnostic retrieved observation',
      detail: strongestObservation.text,
      status: 'supported',
      confidence: clamp(strongestObservation.extractionConfidence),
      sourceIds: [strongestObservation.id, strongestObservation.sourceEvidenceId],
      surfaceCheckIds: evidenceSurfaceId ? [evidenceSurfaceId] : [],
    });
  }
  return findings;
}

export function buildResearchSession(
  input: BuildResearchSessionInput,
): CaseResearchSession {
  const { state, packet, scope, sessionId, review, connected } = input;
  const baseSurfaces = caseSurfaces(state, packet, sessionId);
  const connectedSurfaces: ResearchSurfaceCheck[] = (connected?.surfaces ?? []).map(
    (surface, index) => ({
      id: `${sessionId}-SURFACE-CONNECTED-${index + 1}`,
      ...surface,
      sourceId: null,
    }),
  );
  const surfaceChecks = [...baseSurfaces, ...connectedSurfaces];
  const connectedOffset = baseSurfaces.length;
  const local = localFindings(state, packet, sessionId, review, baseSurfaces);
  const connectedFindings: ResearchFinding[] = (connected?.findings ?? []).map(
    (finding, index) => ({
      id: `${sessionId}-FINDING-CONNECTED-${index + 1}`,
      label: finding.label,
      detail: finding.detail,
      status: finding.status,
      confidence: clamp(finding.confidence),
      sourceIds: [],
      surfaceCheckIds: finding.surfaceIndexes
        .map((surfaceIndex) => connectedSurfaces[surfaceIndex]?.id)
        .filter((id): id is string => Boolean(id)),
    }),
  );
  const negativeFindings = [
    ...caseNegativeFindings(state, packet, sessionId, baseSurfaces),
    ...(connected?.negativeFindings ?? []).map((finding, index) => ({
      id: `${sessionId}-NEGATIVE-CONNECTED-${index + 1}`,
      label: finding.label,
      detail: finding.detail,
      surfaceCheckIds: finding.surfaceIndexes
        .map((surfaceIndex) => surfaceChecks[connectedOffset + surfaceIndex]?.id)
        .filter((id): id is string => Boolean(id)),
    })),
  ];
  const corrections = [
    ...revisionCorrections(state, packet, sessionId),
    ...(connected?.corrections ?? []).map((correction, index) => ({
      id: `${sessionId}-CORRECTION-CONNECTED-${index + 1}`,
      ...correction,
      sourceIds: [],
    })),
  ];
  const leading =
    state.reconstructions.find((item) => item.isLeading) ?? state.reconstructions[0];
  const localNext = unique([
    ...(review ? [review.hypothesis.next_question] : []),
    ...state.anomalies
      .filter(
        (item) =>
          item.status === 'open' &&
          item.relatedIds.some(
            (id) =>
              packet.evidenceIds.includes(id) ||
              packet.observationIds.includes(id) ||
              packet.graphNeighborIds.includes(id),
          ),
      )
      .sort((a, b) => b.expectedInformationGain - a.expectedInformationGain)
      .slice(0, 3)
      .map((item) => item.question),
  ]);
  const answer =
    connected?.answer ?? review?.hypothesis.summary ?? deterministicAnswer(state, packet);
  const confidence = connected?.confidence ?? clamp((leading?.coveragePercent ?? 45) / 100);
  return {
    id: sessionId,
    caseId: state.metadata.id,
    question: packet.question,
    scope,
    answer,
    answerStatus: connected?.answerStatus ?? (leading ? 'bounded-answer' : 'insufficient'),
    confidence,
    findings: scope === 'connected' ? [...connectedFindings, ...local.slice(0, 1)] : local,
    surfaceChecks,
    negativeFindings: negativeFindings.slice(0, 10),
    corrections: corrections.slice(-6),
    nextQuestions: unique([...(connected?.nextQuestions ?? []), ...localNext]).slice(0, 6),
    limitations: unique([
      ...(connected?.limitations ?? []),
      ...(scope === 'case'
        ? [
            'This run searched the preserved case file only; browser history and connected accounts were not inspected.',
          ]
        : [
            'Connected results are unpreserved leads. Ingest a source artifact before using it to support a world relationship.',
          ]),
      'The answer is stored as belief and procedural memory, never as evidence or a world fact.',
    ]),
    provider: connected ? 'aside' : review ? 'openrouter' : 'deterministic',
    model: connected
      ? connected.model
      : review
        ? `${review.hypothesisModel} + ${review.falsifierModel}`
        : null,
    packetId: packet.id,
    runId: input.runId,
    createdAt: input.startedAt,
    completedAt: input.completedAt,
  };
}
