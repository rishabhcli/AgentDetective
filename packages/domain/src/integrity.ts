import type { CaseState } from './types.js';

export type CaseIntegritySeverity = 'error' | 'warning';

export interface CaseIntegrityIssue {
  code: string;
  severity: CaseIntegritySeverity;
  message: string;
  objectId: string | null;
}

export interface CaseIntegrityReport {
  ok: boolean;
  caseId: string;
  revision: number;
  checkedObjects: number;
  issues: CaseIntegrityIssue[];
}

function duplicateIds(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

/**
 * Checks lineage and truthfulness invariants without modifying the case. The
 * report is intentionally deterministic so it can gate CI, health checks, and
 * persistence with the same rules.
 */
export function validateCaseIntegrity(state: CaseState): CaseIntegrityReport {
  const issues: CaseIntegrityIssue[] = [];
  const issue = (
    code: string,
    message: string,
    objectId: string | null = null,
    severity: CaseIntegritySeverity = 'error',
  ) => issues.push({ code, severity, message, objectId });

  const arrays = [
    state.evidence,
    state.observations,
    state.claims,
    state.entities,
    state.worldEdges,
    state.unresolvedReferences,
    state.assumptions,
    state.beliefs,
    state.beliefEdges,
    state.reconstructions,
    state.anomalies,
    state.worldMemory,
    state.evidenceMemory,
    state.beliefMemory,
    state.proceduralMemory,
    state.casePackets,
    state.researchSessions,
    state.agentRuns,
    state.missions,
    state.standingOrders,
    state.clarifications,
    state.temporalConstraints,
    state.revisions,
  ] as const;
  const allIds = arrays.flatMap((items) => items.map((item) => item.id));
  const knownIds = new Set(allIds);
  for (const id of duplicateIds(allIds)) {
    issue('DUPLICATE_ID', `The case contains more than one object with ID ${id}.`, id);
  }

  const evidenceById = new Map(state.evidence.map((item) => [item.id, item] as const));
  const observationById = new Map(
    state.observations.map((item) => [item.id, item] as const),
  );
  const claimById = new Map(state.claims.map((item) => [item.id, item] as const));
  const entityIds = new Set(state.entities.map((item) => item.id));
  const assumptionIds = new Set(state.assumptions.map((item) => item.id));
  const packetIds = new Set(state.casePackets.map((item) => item.id));
  const runIds = new Set(state.agentRuns.map((item) => item.id));
  const surfaceIds = new Set(
    state.researchSessions.flatMap((session) =>
      session.surfaceChecks.map((surface) => surface.id),
    ),
  );

  for (const artifact of state.evidence) {
    if (!/^[a-f0-9]{64}$/u.test(artifact.sha256)) {
      issue(
        'INVALID_SHA256',
        'Evidence must retain a lowercase SHA-256 digest.',
        artifact.id,
      );
    }
    if (!artifact.synthetic && artifact.extractor === 'authored-fixture') {
      issue(
        'UNLABELED_FIXTURE',
        'An authored fixture cannot be presented as non-synthetic evidence.',
        artifact.id,
      );
    }
    if (!artifact.synthetic && /synthetic fixture/iu.test(artifact.chainOfCustody)) {
      issue(
        'SYNTHETIC_CUSTODY_MISMATCH',
        'Chain of custody labels this artifact synthetic while its flag says otherwise.',
        artifact.id,
      );
    }
    for (const observationId of artifact.observationIds) {
      const observation = observationById.get(observationId);
      if (!observation) {
        issue(
          'DANGLING_ARTIFACT_OBSERVATION',
          `Artifact points to missing observation ${observationId}.`,
          artifact.id,
        );
      } else if (observation.sourceEvidenceId !== artifact.id) {
        issue(
          'OBSERVATION_SOURCE_MISMATCH',
          `${observationId} points back to ${observation.sourceEvidenceId}, not ${artifact.id}.`,
          observationId,
        );
      }
    }
    for (const claimId of artifact.claimIds) {
      const claim = claimById.get(claimId);
      if (!claim) {
        issue(
          'DANGLING_ARTIFACT_CLAIM',
          `Artifact points to missing claim ${claimId}.`,
          artifact.id,
        );
      } else if (claim.sourceEvidenceId !== artifact.id) {
        issue(
          'CLAIM_SOURCE_MISMATCH',
          `${claimId} points back to ${claim.sourceEvidenceId}, not ${artifact.id}.`,
          claimId,
        );
      }
    }
  }

  for (const observation of state.observations) {
    const artifact = evidenceById.get(observation.sourceEvidenceId);
    if (!artifact) {
      issue(
        'DANGLING_OBSERVATION_SOURCE',
        `Observation source ${observation.sourceEvidenceId} does not exist.`,
        observation.id,
      );
    } else if (!artifact.observationIds.includes(observation.id)) {
      issue(
        'MISSING_OBSERVATION_BACKLINK',
        'Source artifact does not list this observation.',
        observation.id,
      );
    }
    for (const entityId of observation.entityIds) {
      if (!entityIds.has(entityId)) {
        issue('DANGLING_OBSERVATION_ENTITY', `Unknown entity ${entityId}.`, observation.id);
      }
    }
  }

  for (const claim of state.claims) {
    const artifact = evidenceById.get(claim.sourceEvidenceId);
    if (!artifact) {
      issue(
        'DANGLING_CLAIM_SOURCE',
        `Claim source ${claim.sourceEvidenceId} does not exist.`,
        claim.id,
      );
    } else if (!artifact.claimIds.includes(claim.id)) {
      issue(
        'MISSING_CLAIM_BACKLINK',
        'Source artifact does not list this claim.',
        claim.id,
      );
    }
  }

  for (const edge of state.worldEdges) {
    if (!entityIds.has(edge.subjectId) || !entityIds.has(edge.objectId)) {
      issue(
        'DANGLING_WORLD_EDGE',
        `World edge endpoints must exist (${edge.subjectId} -> ${edge.objectId}).`,
        edge.id,
      );
    }
    for (const id of edge.sourceObservationIds) {
      if (!observationById.has(id))
        issue('DANGLING_EDGE_OBSERVATION', `Unknown observation ${id}.`, edge.id);
    }
    for (const id of edge.sourceClaimIds) {
      if (!claimById.has(id)) issue('DANGLING_EDGE_CLAIM', `Unknown claim ${id}.`, edge.id);
    }
    for (const id of edge.assumptionIds) {
      if (!assumptionIds.has(id))
        issue('DANGLING_EDGE_ASSUMPTION', `Unknown assumption ${id}.`, edge.id);
    }
    if (
      edge.sourceObservationIds.length === 0 &&
      edge.sourceClaimIds.length === 0 &&
      edge.assumptionIds.length === 0
    ) {
      issue(
        'UNSOURCED_WORLD_EDGE',
        'Every visible world relationship must expose a source or assumption.',
        edge.id,
      );
    }
  }

  for (const beliefEdge of state.beliefEdges) {
    if (!knownIds.has(beliefEdge.sourceId) || !knownIds.has(beliefEdge.targetId)) {
      issue(
        'DANGLING_BELIEF_EDGE',
        `Belief edge endpoints must exist (${beliefEdge.sourceId} -> ${beliefEdge.targetId}).`,
        beliefEdge.id,
      );
    }
  }

  for (const packet of state.casePackets) {
    for (const id of packet.evidenceIds) {
      if (!evidenceById.has(id))
        issue('DANGLING_PACKET_EVIDENCE', `Unknown evidence ${id}.`, packet.id);
    }
    for (const id of packet.observationIds) {
      if (!observationById.has(id))
        issue('DANGLING_PACKET_OBSERVATION', `Unknown observation ${id}.`, packet.id);
    }
    for (const hit of packet.retrievalHits ?? []) {
      const observation = observationById.get(hit.observationId);
      if (!observation || observation.sourceEvidenceId !== hit.evidenceId) {
        issue(
          'INVALID_RETRIEVAL_HIT',
          `Retrieval hit ${hit.observationId} does not resolve to ${hit.evidenceId}.`,
          packet.id,
        );
      }
      if (!packet.observationIds.includes(hit.observationId)) {
        issue(
          'UNLISTED_RETRIEVAL_HIT',
          `Retrieval hit ${hit.observationId} is absent from packet observations.`,
          packet.id,
        );
      }
    }
  }

  for (const session of state.researchSessions) {
    if (!packetIds.has(session.packetId)) {
      issue(
        'DANGLING_RESEARCH_PACKET',
        `Research packet ${session.packetId} does not exist.`,
        session.id,
      );
    }
    if (!runIds.has(session.runId)) {
      issue(
        'DANGLING_RESEARCH_RUN',
        `Research run ${session.runId} does not exist.`,
        session.id,
      );
    }
    for (const finding of session.findings) {
      for (const id of finding.sourceIds) {
        if (!knownIds.has(id))
          issue('DANGLING_FINDING_SOURCE', `Unknown finding source ${id}.`, finding.id);
      }
      for (const id of finding.surfaceCheckIds) {
        if (!surfaceIds.has(id))
          issue('DANGLING_FINDING_SURFACE', `Unknown surface ${id}.`, finding.id);
      }
    }
  }

  for (const run of state.agentRuns) {
    if (run.packetId && !packetIds.has(run.packetId)) {
      issue('DANGLING_RUN_PACKET', `Run packet ${run.packetId} does not exist.`, run.id);
    }
    for (const step of run.steps) {
      if (step.status === 'completed' && step.detail.trim().length < 12) {
        issue(
          'UNEXPLAINED_AGENT_STEP',
          'Completed agent work must describe the concrete check or transform.',
          step.id,
        );
      }
    }
  }

  for (const mission of state.missions) {
    if (
      mission.resultSessionId &&
      !state.researchSessions.some((item) => item.id === mission.resultSessionId)
    ) {
      issue(
        'DANGLING_MISSION_SESSION',
        `Mission session ${mission.resultSessionId} does not exist.`,
        mission.id,
      );
    }
    if (mission.runId && !runIds.has(mission.runId)) {
      issue(
        'DANGLING_MISSION_RUN',
        `Mission run ${mission.runId} does not exist.`,
        mission.id,
      );
    }
  }

  return {
    ok: !issues.some((item) => item.severity === 'error'),
    caseId: state.metadata.id,
    revision: state.metadata.revision,
    checkedObjects: allIds.length,
    issues,
  };
}
