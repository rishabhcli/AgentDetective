import type { Assumption, CaseState, Claim, Observation, WorldEdge } from './types.js';

/**
 * Deductive structure over the existing case state.
 *
 * The method this models is the ordinary one: separate what was *seen* from
 * what was *said*, name the leap that turns either into a conclusion, and state
 * the observation that would destroy it. Nothing here authors prose about a
 * case; every rung is derived from records that already carry provenance.
 */

export type RungKind = 'observed' | 'attested' | 'assumed' | 'opposed' | 'concluded';

export interface InferenceRung {
  id: string;
  kind: RungKind;
  /** The claim this rung makes, phrased as the step it contributes. */
  text: string;
  /** Where it came from: locator, speaker, or the leap being taken. */
  detail: string;
  sourceIds: string[];
  /** 0..1. For a warrant this is the assumption's remaining credit. */
  weight: number;
  contested: boolean;
}

export interface DeductionChain {
  id: string;
  caseId: string;
  edgeId: string;
  question: string;
  conclusion: string;
  rungs: InferenceRung[];
  confidence: number;
  /** Rung that caps the chain: the first contested warrant, else the weakest support. */
  weakestRungId: string | null;
  breaksIf: string[];
  alternatives: string[];
  disputed: boolean;
  materialWeight: number;
}

export interface KeystoneAssumption {
  id: string;
  label: string;
  detail: string;
  status: Assumption['status'];
  dependentEdgeIds: string[];
  dependentBeliefIds: string[];
  /** Share of provenance-bearing relationships that rest on this assumption, 0..1. */
  load: number;
}

export type SilenceKind =
  'single-source' | 'unresolved-identity' | 'uncorroborated-warrant';

export interface EvidentialSilence {
  id: string;
  kind: SilenceKind;
  subjectId: string;
  label: string;
  detail: string;
  /** 0..1 — how much currently rests on the thing that is not corroborated. */
  exposure: number;
}

function round(value: number, places = 2): number {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function entityLabel(state: CaseState, entityId: string): string {
  const entity = state.entities.find((item) => item.id === entityId);
  // A conclusion is read as a sentence, so the full label beats the code.
  return entity?.label || entity?.shortLabel || entityId;
}

function readablePredicate(edge: WorldEdge): string {
  return edge.predicate.replaceAll('_', ' ').toLocaleLowerCase();
}

function observationRung(observation: Observation, index: number): InferenceRung {
  return {
    id: `RUNG-OBS-${observation.id}-${index}`,
    kind: 'observed',
    text: observation.text,
    detail: `${observation.locator} · extraction ${Math.round(observation.extractionConfidence * 100)}%`,
    sourceIds: [observation.id, observation.sourceEvidenceId],
    weight: round(observation.extractionConfidence),
    contested: false,
  };
}

function claimRung(claim: Claim, index: number): InferenceRung {
  const speaker = claim.speaker ? `${claim.speaker} stated` : 'The artifact states';
  const hedges =
    claim.hedges.length > 0
      ? ` · hedged with ${claim.hedges.map((hedge) => `“${hedge}”`).join(', ')}`
      : '';
  return {
    id: `RUNG-CLAIM-${claim.id}-${index}`,
    kind: 'attested',
    text: claim.proposition,
    // A claim is testimony about the world, never the world itself.
    detail: `${speaker} · ${claim.sourceReliability}${claim.informationCredibility}${hedges}`,
    sourceIds: [claim.id, claim.sourceEvidenceId],
    weight: round(claim.extractionConfidence),
    contested: claim.hedges.length > 0,
  };
}

function assumptionRung(assumption: Assumption, index: number): InferenceRung {
  return {
    id: `RUNG-ASSUMPTION-${assumption.id}-${index}`,
    kind: 'assumed',
    text: assumption.label,
    detail: assumption.detail,
    sourceIds: [assumption.id, ...assumption.sourceEvidenceIds],
    weight:
      assumption.status === 'valid' ? 0.8 : assumption.status === 'contested' ? 0.4 : 0,
    contested: assumption.status !== 'valid',
  };
}

/**
 * One chain per provenance-bearing relationship, ordered by how much material
 * weight the relationship carries.
 */
export function buildDeductionChains(state: CaseState): DeductionChain[] {
  const chains = state.worldEdges.map((edge) => {
    const observations = edge.sourceObservationIds
      .map((id) => state.observations.find((item) => item.id === id))
      .filter((item): item is Observation => Boolean(item));
    const claims = edge.sourceClaimIds
      .map((id) => state.claims.find((item) => item.id === id))
      .filter((item): item is Claim => Boolean(item));
    const assumptions = edge.assumptionIds
      .map((id) => state.assumptions.find((item) => item.id === id))
      .filter((item): item is Assumption => Boolean(item));

    const rungs: InferenceRung[] = [
      ...observations.map(observationRung),
      ...claims.map(claimRung),
      ...assumptions.map(assumptionRung),
    ];

    for (const [index, contribution] of edge.contributions
      .filter((item) => item.polarity === 'oppose')
      .entries()) {
      rungs.push({
        id: `RUNG-AGAINST-${edge.id}-${index}`,
        kind: 'opposed',
        text: contribution.label,
        detail: `Pulls against the conclusion at weight ${contribution.weight.toFixed(2)}`,
        sourceIds: [contribution.sourceId],
        weight: round(contribution.weight),
        contested: true,
      });
    }

    const subject = entityLabel(state, edge.subjectId);
    const object = entityLabel(state, edge.objectId);
    const conclusion = `${subject} ${readablePredicate(edge)} ${object}`;
    rungs.push({
      id: `RUNG-CONCLUSION-${edge.id}`,
      kind: 'concluded',
      text: conclusion,
      detail: edge.disputed
        ? 'Held as disputed: a competing account survives the same sources.'
        : 'Held while every rung above survives.',
      sourceIds: [edge.id],
      weight: round(edge.confidence),
      contested: edge.disputed,
    });

    // A chain is only as strong as the first leap that is already in doubt.
    const contestedWarrant = rungs.find(
      (rung) => rung.kind === 'assumed' && rung.contested,
    );
    const supportRungs = rungs.filter(
      (rung) => rung.kind === 'observed' || rung.kind === 'attested',
    );
    const weakestSupport = supportRungs.reduce<InferenceRung | null>(
      (weakest, rung) => (!weakest || rung.weight < weakest.weight ? rung : weakest),
      null,
    );

    const breaksIf = [
      ...assumptions.map((assumption) => `${assumption.label} turns out to be false.`),
      ...(observations.length === 1 && observations[0]
        ? [`${observations[0].sourceEvidenceId} is shown to be unreliable.`]
        : []),
    ];

    return {
      id: `CHAIN-${edge.id}`,
      caseId: state.metadata.id,
      edgeId: edge.id,
      question: `What supports “${conclusion}”?`,
      conclusion,
      rungs,
      confidence: round(edge.confidence),
      weakestRungId: contestedWarrant?.id ?? weakestSupport?.id ?? null,
      breaksIf,
      alternatives: edge.alternatives,
      disputed: edge.disputed,
      materialWeight: observations.reduce(
        (total, observation) => total + observation.materialWeight,
        0,
      ),
    } satisfies DeductionChain;
  });

  return chains.sort(
    (a, b) => b.materialWeight - a.materialWeight || b.confidence - a.confidence,
  );
}

/**
 * Which single assumption, if it failed, would take the most of the case with
 * it. This is the question worth asking before any new evidence is gathered.
 */
export function rankKeystoneAssumptions(state: CaseState): KeystoneAssumption[] {
  const edgeTotal = state.worldEdges.length;
  return state.assumptions
    .map((assumption) => {
      const dependentEdgeIds = state.worldEdges
        .filter((edge) => edge.assumptionIds.includes(assumption.id))
        .map((edge) => edge.id);
      const dependentBeliefIds = state.beliefs
        .filter((belief) =>
          belief.environments.some((environment) => environment.includes(assumption.id)),
        )
        .map((belief) => belief.id);
      return {
        id: assumption.id,
        label: assumption.label,
        detail: assumption.detail,
        status: assumption.status,
        dependentEdgeIds,
        dependentBeliefIds,
        load: edgeTotal === 0 ? 0 : round(dependentEdgeIds.length / edgeTotal),
      } satisfies KeystoneAssumption;
    })
    .sort(
      (a, b) =>
        b.dependentEdgeIds.length +
        b.dependentBeliefIds.length -
        (a.dependentEdgeIds.length + a.dependentBeliefIds.length),
    );
}

/**
 * The evidence that is not there. A conclusion resting on a single artifact and
 * an identity that never resolved are both silences worth naming out loud.
 */
export function findEvidentialSilences(state: CaseState): EvidentialSilence[] {
  const silences: EvidentialSilence[] = [];

  for (const edge of state.worldEdges) {
    const sourceEvidenceIds = new Set(
      edge.sourceObservationIds
        .map((id) => state.observations.find((item) => item.id === id)?.sourceEvidenceId)
        .filter((id): id is string => Boolean(id)),
    );
    if (sourceEvidenceIds.size === 1 && edge.sourceObservationIds.length > 0) {
      const only = [...sourceEvidenceIds][0] ?? 'an unnamed artifact';
      silences.push({
        id: `SILENCE-SINGLE-${edge.id}`,
        kind: 'single-source',
        subjectId: edge.id,
        label: `${entityLabel(state, edge.subjectId)} → ${entityLabel(state, edge.objectId)} rests on one artifact`,
        detail: `Every observation behind this relationship comes from ${only}. Independent corroboration has not been found, so the relationship inherits that artifact's failure modes.`,
        exposure: round(edge.confidence),
      });
    }
  }

  for (const reference of state.unresolvedReferences) {
    if (reference.status === 'resolved') continue;
    const leading = [...reference.candidateBindings].sort(
      (a, b) => b.probability - a.probability,
    )[0];
    silences.push({
      id: `SILENCE-IDENTITY-${reference.id}`,
      kind: 'unresolved-identity',
      subjectId: reference.id,
      label: `“${reference.surfaceForm}” has never been resolved`,
      detail: leading
        ? `The leading binding is ${leading.label} at ${Math.round(leading.probability * 100)}%, which is a distribution and not a name. Everything downstream carries that spread.`
        : 'No candidate binding has any supporting signal at all.',
      exposure: leading ? round(1 - leading.probability) : 1,
    });
  }

  for (const assumption of state.assumptions) {
    if (assumption.status === 'invalid') continue;
    if (assumption.sourceEvidenceIds.length > 1) continue;
    silences.push({
      id: `SILENCE-WARRANT-${assumption.id}`,
      kind: 'uncorroborated-warrant',
      subjectId: assumption.id,
      label: `${assumption.label} is asserted from a single source`,
      detail: `${assumption.detail} Nothing independent has been produced that would confirm or break it.`,
      exposure: round(
        state.worldEdges.filter((edge) => edge.assumptionIds.includes(assumption.id))
          .length / Math.max(1, state.worldEdges.length),
      ),
    });
  }

  return silences.sort((a, b) => b.exposure - a.exposure);
}
