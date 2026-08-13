import { describe, expect, it } from 'vitest';
import { createEmptyCase } from './inference.js';
import type { CaseState } from './types.js';
import {
  admiraltyStrength,
  allenRelation,
  applyCounterEvidence,
  computeWeightedCoverage,
  createSampleCase,
  enforceTemporalPathConsistency,
  ingestLocalEvidence,
  inferEvidenceKind,
  investigateAnomaly,
  isMaterialEvidenceKindConflict,
  propagateNogood,
  rankQuestionsByInformationGain,
  scoreCandidateBindings,
  shannonEntropy,
} from './index.js';

describe('THREAD domain invariants', () => {
  it('keeps every claim attached to an immutable source artifact', () => {
    const state = createSampleCase();
    const evidenceIds = new Set(state.evidence.map((artifact) => artifact.id));
    expect(state.claims.every((claim) => evidenceIds.has(claim.sourceEvidenceId))).toBe(
      true,
    );
    expect(state.claims.find((claim) => claim.id === 'C-101')?.proposition).toContain(
      'Alex believes',
    );
    expect(
      state.worldEdges.some(
        (edge) => edge.subjectId === 'E-JORDAN' && edge.predicate === 'OBSERVED_AT',
      ),
    ).toBe(true);
    expect(state.metadata.synthetic).toBe(true);
  });

  it('scores identity candidates from explicit signals without hard-merging the reference', () => {
    const state = createSampleCase();
    const reference = state.unresolvedReferences.find((item) => item.id === 'U-J')!;
    const scored = scoreCandidateBindings(reference);
    expect(scored[0]?.label).toBe('Jordan Lee');
    expect(scored[0]?.probability).toBe(0.83);
    expect(scored[0]?.signalIds).toEqual([
      'SIG-J-ALIAS',
      'SIG-J-CALENDAR',
      'SIG-J-OBJECT',
      'SIG-J-SOCIAL',
    ]);

    const result = investigateAnomaly(state, 'AN-J', '2026-08-12T23:00:00.000Z');
    const updated = result.state.unresolvedReferences.find((item) => item.id === 'U-J')!;
    expect(updated.surfaceForm).toBe('J');
    expect(updated.status).toBe('candidate');
    expect(updated.candidateBindings[0]?.probability).toBe(0.83);
    expect(result.state.proceduralMemory).toHaveLength(1);
    expect(result.state.evidence.find((item) => item.id === 'EV-014')?.content).toContain(
      'did J ever',
    );
  });

  it('propagates a nogood through ATMS environments', () => {
    const state = createSampleCase();
    const propagated = propagateNogood(state.beliefs, new Set(['A-19']));
    const vehicleHypothesis = propagated.find((belief) => belief.id === 'H-08')!;
    const entryHypothesis = propagated.find((belief) => belief.id === 'H-03')!;
    expect(vehicleHypothesis.survivingEnvironments).toHaveLength(0);
    expect(vehicleHypothesis.status).toBe('rejected');
    expect(entryHypothesis.survivingEnvironments).toEqual([['A-14', 'A-07']]);
    expect(entryHypothesis.status).toBe('weakened');
  });

  it('creates a real revision and flips reconstructions when counter-evidence arrives', () => {
    const state = createSampleCase();
    const result = applyCounterEvidence(state, '2026-08-12T23:05:00.000Z');
    expect(result.revision?.triggerEvidenceId).toBe('EV-143');
    expect(result.state.evidence[0]?.id).toBe('EV-143');
    expect(result.state.assumptions.find((item) => item.id === 'A-19')?.status).toBe(
      'invalid',
    );
    expect(
      result.state.worldEdges.find((item) => item.id === 'WE-VEHICLE-WAREHOUSE')
        ?.confidence,
    ).toBe(0.18);
    expect(
      result.state.reconstructions.find((item) => item.id === 'R-A')?.coveragePercent,
    ).toBe(48);
    expect(result.state.reconstructions.find((item) => item.id === 'R-C')?.isLeading).toBe(
      true,
    );

    const repeat = applyCounterEvidence(result.state, '2026-08-12T23:06:00.000Z');
    expect(repeat.revision).toBeNull();
    expect(repeat.state.evidence.filter((item) => item.id === 'EV-143')).toHaveLength(1);
  });

  it('ingests text as source-bound claims and retains vague references', () => {
    const state = createSampleCase();
    const edgeCount = state.worldEdges.length;
    const result = ingestLocalEvidence(state, {
      title: 'New witness note',
      fileName: 'note.txt',
      mimeType: 'text/plain',
      kind: 'document',
      sha256: 'a'.repeat(64),
      content: 'Riley: I think someone left the package there around nine.',
      rawLocator: '/tmp/note.txt',
      sourceLabel: 'User upload',
      sourceReliability: 'F',
      informationCredibility: 6,
      timestamp: '2026-08-12T23:10:00.000Z',
    });
    const artifact = result.state.evidence[0]!;
    expect(artifact.synthetic).toBe(false);
    expect(artifact.extractionStatus).toBe('bounded-local');
    expect(result.state.claims[0]?.verbatim).toContain('someone left');
    expect(result.state.claims[0]?.hedges).toEqual(['i think', 'around']);
    expect(
      result.state.unresolvedReferences.slice(0, 3).map((item) => item.surfaceForm),
    ).toEqual(expect.arrayContaining(['someone', 'the package', 'there']));
    expect(result.state.worldEdges).toHaveLength(edgeCount);
  });

  it('retains binary media without fabricating an interpretation', () => {
    const result = ingestLocalEvidence(createSampleCase(), {
      title: 'Unknown frame',
      fileName: 'frame.jpg',
      mimeType: 'image/jpeg',
      kind: 'image',
      sha256: 'b'.repeat(64),
      content: null,
      rawLocator: '/tmp/frame.jpg',
      sourceLabel: 'User upload',
      sourceReliability: 'F',
      informationCredibility: 6,
      timestamp: '2026-08-12T23:10:00.000Z',
    });
    expect(result.state.evidence[0]?.extractionStatus).toBe('requires-adapter');
    expect(result.state.evidence[0]?.claimIds).toEqual([]);
    expect(result.state.observations[0]?.kind).toBe('unprocessed-media');
  });

  it('infers only artifact containers and escalates hard type conflicts', () => {
    expect(inferEvidenceKind('camera-frame.HEIC', 'application/octet-stream')).toBe(
      'image',
    );
    expect(inferEvidenceKind('history.zip', 'application/zip')).toBe('document');
    expect(inferEvidenceKind('unknown.custom', 'application/octet-stream')).toBe('other');
    expect(isMaterialEvidenceKindConflict('document', 'image')).toBe(true);
    expect(isMaterialEvidenceKindConflict('message', 'document')).toBe(false);
    expect(isMaterialEvidenceKindConflict('other', 'video')).toBe(false);
  });

  it('classifies Allen interval relationships without inventing precision', () => {
    const interval = (start: string, end: string) => ({
      earliest: `2026-08-04T${start}:00.000Z`,
      latest: `2026-08-04T${end}:00.000Z`,
      precision: 'range' as const,
      confidence: 1,
    });
    expect(allenRelation(interval('20:00', '20:30'), interval('21:00', '21:30'))).toBe(
      'before',
    );
    expect(allenRelation(interval('20:00', '21:10'), interval('21:00', '21:30'))).toBe(
      'overlaps',
    );
    expect(allenRelation(interval('21:00', '21:30'), interval('21:00', '21:30'))).toBe(
      'equals',
    );
  });

  it('propagates Allen constraints and exposes temporal contradictions', () => {
    const result = enforceTemporalPathConsistency([
      {
        id: 'TC-1',
        caseId: 'case-badge-17',
        sourceEventId: 'A',
        targetEventId: 'B',
        possibleRelations: ['before'],
        sourceIds: ['O-1'],
        status: 'consistent',
      },
      {
        id: 'TC-2',
        caseId: 'case-badge-17',
        sourceEventId: 'B',
        targetEventId: 'C',
        possibleRelations: ['before'],
        sourceIds: ['O-2'],
        status: 'consistent',
      },
      {
        id: 'TC-3',
        caseId: 'case-badge-17',
        sourceEventId: 'C',
        targetEventId: 'A',
        possibleRelations: ['before'],
        sourceIds: ['O-3'],
        status: 'consistent',
      },
    ]);
    expect(result.consistent).toBe(false);
    expect(result.contradictions.length).toBeGreaterThan(0);
    expect(
      result.constraints.some((constraint) => constraint.status === 'inconsistent'),
    ).toBe(true);
  });

  it('ranks questions by expected entropy reduction', () => {
    expect(shannonEntropy([0.5, 0.5])).toBe(1);
    const ranked = rankQuestionsByInformationGain(
      [0.5, 0.5],
      [
        {
          id: 'low-value',
          question: 'Does a non-diagnostic detail change?',
          answers: [
            {
              label: 'yes',
              probability: 0.5,
              posteriorHypothesisProbabilities: [0.5, 0.5],
            },
            {
              label: 'no',
              probability: 0.5,
              posteriorHypothesisProbabilities: [0.5, 0.5],
            },
          ],
        },
        {
          id: 'high-value',
          question: 'Which mutually exclusive location is verified?',
          answers: [
            {
              label: 'warehouse',
              probability: 0.5,
              posteriorHypothesisProbabilities: [1, 0],
            },
            {
              label: 'pier',
              probability: 0.5,
              posteriorHypothesisProbabilities: [0, 1],
            },
          ],
        },
      ],
    );
    expect(ranked[0]?.id).toBe('high-value');
    expect(ranked[0]?.expectedInformationGain).toBe(1);
  });

  it('keeps Admiralty axes separate and computes weighted coverage', () => {
    expect(admiraltyStrength('B', 2)).toEqual({
      sourceReliability: 0.82,
      informationCredibility: 0.8,
      combinedStrength: 0.81,
    });
    const coverage = computeWeightedCoverage([
      { id: 'direct', weight: 4, support: 'direct' },
      { id: 'corroborated', weight: 3, support: 'multi-source' },
      { id: 'inference', weight: 1, support: 'inferred' },
      { id: 'gap', weight: 2, support: 'unexplained' },
    ]);
    expect(coverage.coveragePercent).toBe(80);
    expect(coverage.breakdown).toEqual({
      observedDirectly: 40,
      multiSourceSupported: 30,
      inferred: 10,
      unexplained: 20,
    });
  });
});

describe('general investigation of a derived question', () => {
  function baseCase(): CaseState {
    return createEmptyCase({
      id: 'case-gen',
      title: 'General',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
  }

  function placementEdge(input: {
    id: string;
    object: string;
    observationIds: string[];
    confidence: number;
  }) {
    return {
      id: input.id,
      caseId: 'case-gen',
      subjectId: 'E-DANA',
      predicate: 'OBSERVED_AT' as const,
      objectId: input.object,
      confidence: input.confidence,
      sourceClaimIds: [],
      sourceObservationIds: input.observationIds,
      contributions: [],
      validTime: null,
      transactionTime: '2026-01-01T00:00:00.000Z',
      disputed: false,
      alternatives: [],
      createdByAgent: 'linker' as const,
      assumptionIds: [],
      lenses: ['people' as const],
    };
  }

  function observationFrom(id: string, evidenceId: string, text: string) {
    return {
      id,
      caseId: 'case-gen',
      sourceEvidenceId: evidenceId,
      kind: 'text' as const,
      text,
      locator: 'line 1',
      extractionConfidence: 1,
      interval: null,
      entityIds: [],
      materialWeight: 1,
    };
  }

  it('rescores an open identity and keeps the alternatives', () => {
    const state = baseCase();
    state.unresolvedReferences.push({
      id: 'U-D',
      caseId: 'case-gen',
      surfaceForm: 'D',
      context: '',
      kindProbabilities: { person: 1 },
      candidateBindings: [
        {
          entityId: 'E-A',
          label: 'Alice Chen',
          probability: 0.5,
          prior: 0.5,
          signalIds: [],
        },
        { entityId: 'E-B', label: 'Bo Marsh', probability: 0.5, prior: 0.5, signalIds: [] },
      ],
      resolutionSignals: [
        {
          id: 'RS-1',
          candidateEntityId: 'E-A',
          evidenceId: 'EV-1',
          channel: 'social',
          label: 'shared contact',
          weight: 1.4,
        },
        {
          id: 'RS-2',
          candidateEntityId: 'E-A',
          evidenceId: 'EV-2',
          channel: 'temporal',
          label: 'same window',
          weight: 0.9,
        },
      ],
      status: 'open',
      resolvedBy: null,
      sourceEvidenceIds: ['EV-1'],
    });
    state.anomalies.push({
      id: 'AN-U-D',
      caseId: 'case-gen',
      question: 'Who is “D”?',
      category: 'who',
      detail: 'Two bindings remain open.',
      expectedInformationGain: 1,
      status: 'open',
      relatedIds: ['U-D'],
      lastResult: null,
    });

    const result = investigateAnomaly(state, 'AN-U-D', '2026-02-02T00:00:00.000Z');
    const reference = result.state.unresolvedReferences[0];

    expect(reference?.status).toBe('candidate');
    expect(reference?.candidateBindings[0]?.label).toBe('Alice Chen');
    expect(reference?.candidateBindings[0]?.probability).toBeGreaterThan(0.5);
    // The losing candidate is retained rather than discarded.
    expect(reference?.candidateBindings).toHaveLength(2);
    expect(result.state.anomalies[0]?.lastResult).toContain('Alice Chen');
    expect(result.revision).not.toBeNull();
  });

  it('weakens the less corroborated side of a contradiction', () => {
    const state = baseCase();
    state.observations.push(
      observationFrom('O-1', 'EV-1', 'Dana at Warehouse A.'),
      observationFrom('O-2', 'EV-2', 'Dana at Pier 48.'),
      observationFrom('O-3', 'EV-3', 'Dana at Pier 48 again.'),
    );
    state.worldEdges.push(
      placementEdge({
        id: 'WE-WAREHOUSE',
        object: 'E-WAREHOUSE',
        observationIds: ['O-1'],
        confidence: 0.7,
      }),
      placementEdge({
        id: 'WE-PIER',
        object: 'E-PIER',
        observationIds: ['O-2', 'O-3'],
        confidence: 0.7,
      }),
    );
    state.beliefs.push({
      id: 'B-CONTRA-1',
      caseId: 'case-gen',
      kind: 'contradiction',
      label: 'Two placements conflict',
      detail: 'x',
      status: 'contested',
      confidence: 0.7,
      sourceIds: ['WE-WAREHOUSE', 'WE-PIER'],
      environments: [[]],
      survivingEnvironments: [[]],
    });
    state.anomalies.push({
      id: 'AN-B-CONTRA-1',
      caseId: 'case-gen',
      question: 'Which placement is wrong?',
      category: 'where',
      detail: 'x',
      expectedInformationGain: 2,
      status: 'open',
      relatedIds: ['B-CONTRA-1', 'WE-WAREHOUSE', 'WE-PIER'],
      lastResult: null,
    });

    const result = investigateAnomaly(state, 'AN-B-CONTRA-1', '2026-02-02T00:00:00.000Z');
    const warehouse = result.state.worldEdges.find((edge) => edge.id === 'WE-WAREHOUSE');
    const pier = result.state.worldEdges.find((edge) => edge.id === 'WE-PIER');

    expect(warehouse?.confidence).toBeLessThan(0.7);
    expect(warehouse?.disputed).toBe(true);
    // The better-supported side is not promoted to a fact either.
    expect(pier?.confidence).toBeLessThanOrEqual(0.95);
    expect(result.state.anomalies[0]?.lastResult).toMatch(/1 artifact|2 artifacts/);
  });

  it('refuses to pick a side when nothing separates the two accounts', () => {
    const state = baseCase();
    state.observations.push(
      observationFrom('O-1', 'EV-1', 'Dana at Warehouse A.'),
      observationFrom('O-2', 'EV-2', 'Dana at Pier 48.'),
    );
    state.worldEdges.push(
      placementEdge({
        id: 'WE-WAREHOUSE',
        object: 'E-WAREHOUSE',
        observationIds: ['O-1'],
        confidence: 0.7,
      }),
      placementEdge({
        id: 'WE-PIER',
        object: 'E-PIER',
        observationIds: ['O-2'],
        confidence: 0.7,
      }),
    );
    state.beliefs.push({
      id: 'B-CONTRA-1',
      caseId: 'case-gen',
      kind: 'contradiction',
      label: 'Two placements conflict',
      detail: 'x',
      status: 'contested',
      confidence: 0.7,
      sourceIds: ['WE-WAREHOUSE', 'WE-PIER'],
      environments: [[]],
      survivingEnvironments: [[]],
    });
    state.anomalies.push({
      id: 'AN-B-CONTRA-1',
      caseId: 'case-gen',
      question: 'Which placement is wrong?',
      category: 'where',
      detail: 'x',
      expectedInformationGain: 2,
      status: 'open',
      relatedIds: ['B-CONTRA-1', 'WE-WAREHOUSE', 'WE-PIER'],
      lastResult: null,
    });

    const result = investigateAnomaly(state, 'AN-B-CONTRA-1', '2026-02-02T00:00:00.000Z');

    expect(
      result.state.worldEdges.find((edge) => edge.id === 'WE-WAREHOUSE')?.confidence,
    ).toBe(0.7);
    expect(result.state.worldEdges.find((edge) => edge.id === 'WE-PIER')?.confidence).toBe(
      0.7,
    );
    expect(result.state.anomalies[0]?.lastResult?.toLowerCase()).toContain('nothing');
  });

  it('raises a single-source relationship when another artifact corroborates it', () => {
    const state = baseCase();
    state.entities.push(
      {
        id: 'E-DANA',
        caseId: 'case-gen',
        kind: 'person',
        label: 'Dana Reyes',
        shortLabel: 'Dana',
        description: '',
        aliases: [],
        properties: {},
        confidence: 0.8,
        sourceEvidenceIds: ['EV-1'],
        interval: null,
      },
      {
        id: 'E-PIER',
        caseId: 'case-gen',
        kind: 'location',
        label: 'Pier 48',
        shortLabel: 'Pier 48',
        description: '',
        aliases: [],
        properties: {},
        confidence: 0.8,
        sourceEvidenceIds: ['EV-1'],
        interval: null,
      },
    );
    state.observations.push(
      observationFrom('O-1', 'EV-1', 'Dana Reyes at Pier 48.'),
      observationFrom('O-2', 'EV-2', 'Dana Reyes was later seen at Pier 48 again.'),
    );
    state.worldEdges.push(
      placementEdge({
        id: 'WE-PIER',
        object: 'E-PIER',
        observationIds: ['O-1'],
        confidence: 0.4,
      }),
    );
    state.anomalies.push({
      id: 'AN-CORROB-WE-PIER',
      caseId: 'case-gen',
      question: 'Can Dana Reyes → Pier 48 be corroborated independently?',
      category: 'what',
      detail: 'This relationship rests on one artifact.',
      expectedInformationGain: 0.9,
      status: 'open',
      relatedIds: ['WE-PIER', 'EV-1'],
      lastResult: null,
    });

    const result = investigateAnomaly(
      state,
      'AN-CORROB-WE-PIER',
      '2026-02-02T00:00:00.000Z',
    );
    const edge = result.state.worldEdges.find((item) => item.id === 'WE-PIER');

    expect(edge?.confidence).toBeGreaterThan(0.4);
    expect(edge?.sourceObservationIds).toContain('O-2');
    expect(edge?.contributions.some((item) => item.polarity === 'support')).toBe(true);
  });

  it('names the silence when nothing corroborates a lone relationship', () => {
    const state = baseCase();
    state.entities.push(
      {
        id: 'E-DANA',
        caseId: 'case-gen',
        kind: 'person',
        label: 'Dana Reyes',
        shortLabel: 'Dana',
        description: '',
        aliases: [],
        properties: {},
        confidence: 0.8,
        sourceEvidenceIds: ['EV-1'],
        interval: null,
      },
      {
        id: 'E-PIER',
        caseId: 'case-gen',
        kind: 'location',
        label: 'Pier 48',
        shortLabel: 'Pier 48',
        description: '',
        aliases: [],
        properties: {},
        confidence: 0.8,
        sourceEvidenceIds: ['EV-1'],
        interval: null,
      },
    );
    state.observations.push(observationFrom('O-1', 'EV-1', 'Dana Reyes at Pier 48.'));
    state.worldEdges.push(
      placementEdge({
        id: 'WE-PIER',
        object: 'E-PIER',
        observationIds: ['O-1'],
        confidence: 0.4,
      }),
    );
    state.anomalies.push({
      id: 'AN-CORROB-WE-PIER',
      caseId: 'case-gen',
      question: 'Can Dana Reyes → Pier 48 be corroborated independently?',
      category: 'what',
      detail: 'This relationship rests on one artifact.',
      expectedInformationGain: 0.9,
      status: 'open',
      relatedIds: ['WE-PIER', 'EV-1'],
      lastResult: null,
    });

    const result = investigateAnomaly(
      state,
      'AN-CORROB-WE-PIER',
      '2026-02-02T00:00:00.000Z',
    );

    expect(result.state.worldEdges[0]?.confidence).toBe(0.4);
    expect(result.state.anomalies[0]?.lastResult?.toLowerCase()).toContain(
      'no independent',
    );
  });

  it('stays idempotent once a question has been investigated', () => {
    const state = baseCase();
    state.anomalies.push({
      id: 'AN-X',
      caseId: 'case-gen',
      question: 'What happened?',
      category: 'what',
      detail: 'x',
      expectedInformationGain: 0.5,
      status: 'open',
      relatedIds: [],
      lastResult: null,
    });

    const first = investigateAnomaly(state, 'AN-X', '2026-02-02T00:00:00.000Z');
    const second = investigateAnomaly(first.state, 'AN-X', '2026-03-03T00:00:00.000Z');
    expect(second.revision).toBeNull();
  });
});
