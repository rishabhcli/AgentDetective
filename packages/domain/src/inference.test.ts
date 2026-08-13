import { describe, expect, it } from 'vitest';
import {
  abduceHypotheses,
  buildReconstructions,
  createEmptyCase,
  deriveTemporalConstraints,
  deriveWorldEdges,
  detectContradictions,
  extractEntityMentions,
  extractTemporalInterval,
  rankOpenQuestions,
  resolveEntities,
  runInferencePass,
  type EntityMention,
} from './inference.js';
import type { Claim, Entity, Observation } from './types.js';

function mention(
  partial: Partial<EntityMention> & { id: string; surfaceForm: string },
): EntityMention {
  return {
    normalized: partial.surfaceForm.toLocaleLowerCase(),
    kindProbabilities: { person: 0.8, unknown: 0.2 },
    sourceEvidenceId: 'EV-T1',
    sourceRecordId: 'C-1',
    recordType: 'claim',
    locator: 'quoted claim C-1',
    channel: 'lexical',
    confidence: 0.7,
    vague: false,
    context: '',
    ...partial,
  };
}

function entity(partial: Partial<Entity> & { id: string; label: string }): Entity {
  return {
    caseId: 'case-test',
    kind: 'person',
    shortLabel: partial.label.split(' ')[0] ?? partial.label,
    description: '',
    aliases: [],
    properties: {},
    confidence: 0.6,
    sourceEvidenceIds: ['EV-T0'],
    interval: null,
    ...partial,
  };
}

function observation(
  partial: Partial<Observation> & { id: string; text: string },
): Observation {
  return {
    caseId: 'case-test',
    sourceEvidenceId: 'EV-T1',
    kind: 'text',
    locator: 'line 1',
    extractionConfidence: 1,
    interval: null,
    entityIds: [],
    materialWeight: 1,
    ...partial,
  };
}

function claim(partial: Partial<Claim> & { id: string; verbatim: string }): Claim {
  return {
    caseId: 'case-test',
    sourceEvidenceId: 'EV-T1',
    speaker: null,
    proposition: `The artifact contains the statement: ${partial.verbatim}`,
    extractionConfidence: 1,
    sourceReliability: 'C',
    informationCredibility: 3,
    hedges: [],
    interval: null,
    unresolvedReferenceIds: [],
    ...partial,
  };
}

describe('extractEntityMentions', () => {
  it('returns nothing for a case with no observations or claims', () => {
    expect(extractEntityMentions([], [])).toEqual([]);
  });

  it('treats a claim speaker as a person mention carrying its source locator', () => {
    const mentions = extractEntityMentions(
      [],
      [
        claim({
          id: 'C-1',
          speaker: 'Dana Reyes',
          verbatim: 'I locked the gate at nine.',
          sourceEvidenceId: 'EV-STATEMENT',
        }),
      ],
    );

    const speaker = mentions.find((mention) => mention.channel === 'speaker');
    expect(speaker).toBeDefined();
    expect(speaker?.surfaceForm).toBe('Dana Reyes');
    expect(speaker?.kindProbabilities.person).toBeGreaterThan(0.5);
    expect(speaker?.sourceEvidenceId).toBe('EV-STATEMENT');
    expect(speaker?.sourceRecordId).toBe('C-1');
  });

  it('finds a capitalized name inside statement text as a person candidate', () => {
    const mentions = extractEntityMentions(
      [],
      [claim({ id: 'C-1', verbatim: 'Marcus Webb signed for the delivery.' })],
    );

    const marcus = mentions.find((mention) => mention.surfaceForm === 'Marcus Webb');
    expect(marcus).toBeDefined();
    expect(marcus?.kindProbabilities.person).toBeGreaterThan(0.5);
    expect(marcus?.vague).toBe(false);
  });

  it('does not invent a mention from a capitalized sentence opener', () => {
    const mentions = extractEntityMentions(
      [],
      [claim({ id: 'C-1', verbatim: 'Later the shipment was moved.' })],
    );

    expect(mentions.map((mention) => mention.surfaceForm)).not.toContain('Later');
  });

  it('marks a vague reference as vague rather than naming an entity', () => {
    const mentions = extractEntityMentions(
      [],
      [claim({ id: 'C-1', verbatim: 'Someone was already waiting there.' })],
    );

    const vague = mentions.filter((mention) => mention.vague);
    expect(vague.length).toBeGreaterThan(0);
    expect(vague.map((mention) => mention.surfaceForm)).toContain('someone');
    // A vague word is a hole in the record, never a named participant.
    expect(vague.every((mention) => mention.channel === 'vague')).toBe(true);
  });

  it('reads an organization from a corporate suffix rather than guessing a person', () => {
    const mentions = extractEntityMentions(
      [],
      [claim({ id: 'C-1', verbatim: 'The pallet came from Harbor Freight Ltd.' })],
    );

    const org = mentions.find((mention) =>
      mention.surfaceForm.startsWith('Harbor Freight'),
    );
    expect(org?.kindProbabilities.organization).toBeGreaterThan(
      org?.kindProbabilities.person ?? 1,
    );
  });

  it('extracts identifier-shaped strings with the kind the shape implies', () => {
    const mentions = extractEntityMentions(
      [
        observation({
          id: 'O-1',
          text: 'Plate 7VXK220 passed the gate; contact was dana@harbor.example.',
        }),
      ],
      [],
    );

    const plate = mentions.find((mention) => mention.surfaceForm === '7VXK220');
    const email = mentions.find((mention) => mention.surfaceForm === 'dana@harbor.example');
    expect(plate?.channel).toBe('identifier');
    expect(plate?.kindProbabilities.vehicle).toBeGreaterThan(0.4);
    expect(email?.channel).toBe('identifier');
    expect(email?.kindProbabilities.account).toBeGreaterThan(0.5);
  });

  it('reads a place from a locative preposition', () => {
    const mentions = extractEntityMentions(
      [observation({ id: 'O-1', text: 'The van was parked at Pier 48 for an hour.' })],
      [],
    );

    const place = mentions.find((mention) => mention.surfaceForm === 'Pier 48');
    expect(place?.kindProbabilities.location).toBeGreaterThan(
      place?.kindProbabilities.person ?? 1,
    );
  });

  it('keeps a name opening a statement even when the record also has a speaker', () => {
    // The speaker is metadata about the record, not a span inside it, so it must
    // not win an overlap contest against the first words of the quotation.
    const mentions = extractEntityMentions(
      [],
      [
        claim({
          id: 'C-1',
          speaker: 'Camera 4',
          verbatim: 'Dana Reyes at Warehouse A.',
        }),
      ],
    );

    expect(mentions.map((mention) => mention.surfaceForm)).toEqual(
      expect.arrayContaining(['Camera 4', 'Dana Reyes', 'Warehouse A']),
    );
  });

  it('is deterministic: the same records produce the same mention IDs in the same order', () => {
    const records = [
      claim({ id: 'C-1', verbatim: 'Marcus Webb met Dana Reyes at Pier 48.' }),
    ];

    const first = extractEntityMentions([], records);
    const second = extractEntityMentions([], records);
    expect(first.map((mention) => mention.id)).toEqual(second.map((mention) => mention.id));
    expect(first).toEqual(second);
  });

  it('keeps every mention traceable to the exact record that produced it', () => {
    const mentions = extractEntityMentions(
      [observation({ id: 'O-9', text: 'Pier 48 gate camera.', locator: 'frame 12' })],
      [claim({ id: 'C-9', verbatim: 'Dana Reyes was there.', speaker: 'Marcus Webb' })],
    );

    expect(mentions.length).toBeGreaterThan(0);
    for (const mention of mentions) {
      expect(mention.sourceRecordId === 'O-9' || mention.sourceRecordId === 'C-9').toBe(
        true,
      );
      expect(mention.locator.length).toBeGreaterThan(0);
      expect(mention.sourceEvidenceId).toBe('EV-T1');
    }
  });
});

describe('resolveEntities', () => {
  it('derives nothing from no mentions', () => {
    const result = resolveEntities([], [], { caseId: 'case-test' });
    expect(result.entities).toEqual([]);
    expect(result.references).toEqual([]);
  });

  it('never promotes a vague mention to an entity', () => {
    const result = resolveEntities(
      [mention({ id: 'MEN-1', surfaceForm: 'someone', channel: 'vague', vague: true })],
      [],
      { caseId: 'case-test' },
    );

    expect(result.entities).toEqual([]);
    expect(result.references).toHaveLength(1);
    expect(result.references[0]?.surfaceForm).toBe('someone');
    expect(result.references[0]?.status).toBe('open');
  });

  it('merges identical surface forms across artifacts into one entity', () => {
    const result = resolveEntities(
      [
        mention({ id: 'MEN-1', surfaceForm: 'Dana Reyes', sourceEvidenceId: 'EV-A' }),
        mention({ id: 'MEN-2', surfaceForm: 'Dana Reyes', sourceEvidenceId: 'EV-B' }),
      ],
      [],
      { caseId: 'case-test' },
    );

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]?.sourceEvidenceIds).toEqual(
      expect.arrayContaining(['EV-A', 'EV-B']),
    );
  });

  it('rates a two-artifact entity above a single-artifact one', () => {
    const corroborated = resolveEntities(
      [
        mention({ id: 'MEN-1', surfaceForm: 'Dana Reyes', sourceEvidenceId: 'EV-A' }),
        mention({ id: 'MEN-2', surfaceForm: 'Dana Reyes', sourceEvidenceId: 'EV-B' }),
      ],
      [],
      { caseId: 'case-test' },
    );
    const lone = resolveEntities(
      [mention({ id: 'MEN-1', surfaceForm: 'Marcus Webb', sourceEvidenceId: 'EV-A' })],
      [],
      { caseId: 'case-test' },
    );

    expect(corroborated.entities[0]?.confidence).toBeGreaterThan(
      lone.entities[0]?.confidence ?? 1,
    );
  });

  it('does not hard-merge a partial name into a fuller one', () => {
    const result = resolveEntities(
      [
        mention({ id: 'MEN-1', surfaceForm: 'Dana Reyes', sourceEvidenceId: 'EV-A' }),
        mention({ id: 'MEN-2', surfaceForm: 'Dana', sourceEvidenceId: 'EV-B' }),
      ],
      [],
      { caseId: 'case-test' },
    );

    expect(result.entities.map((item) => item.label)).toEqual(['Dana Reyes']);
    const reference = result.references.find((item) => item.surfaceForm === 'Dana');
    expect(reference).toBeDefined();
    expect(reference?.status).toBe('candidate');
    expect(reference?.candidateBindings.some((binding) => binding.entityId !== null)).toBe(
      true,
    );
  });

  it('keeps both options open when a partial name fits two people', () => {
    const result = resolveEntities(
      [
        mention({ id: 'MEN-1', surfaceForm: 'Dana Reyes', sourceEvidenceId: 'EV-A' }),
        mention({ id: 'MEN-2', surfaceForm: 'Dana Whitlock', sourceEvidenceId: 'EV-B' }),
        mention({ id: 'MEN-3', surfaceForm: 'Dana', sourceEvidenceId: 'EV-C' }),
      ],
      [],
      { caseId: 'case-test' },
    );

    const reference = result.references.find((item) => item.surfaceForm === 'Dana');
    const bound =
      reference?.candidateBindings.filter((item) => item.entityId !== null) ?? [];
    expect(bound).toHaveLength(2);
    const total = reference?.candidateBindings.reduce(
      (sum, binding) => sum + binding.probability,
      0,
    );
    expect(total).toBeCloseTo(1, 2);
  });

  it('attaches to an existing entity instead of creating a duplicate', () => {
    const result = resolveEntities(
      [mention({ id: 'MEN-1', surfaceForm: 'Dana Reyes', sourceEvidenceId: 'EV-NEW' })],
      [entity({ id: 'E-DANA', label: 'Dana Reyes' })],
      { caseId: 'case-test' },
    );

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]?.id).toBe('E-DANA');
    expect(result.entities[0]?.sourceEvidenceIds).toContain('EV-NEW');
  });

  it('takes the entity kind from the aggregated mention distribution', () => {
    const result = resolveEntities(
      [
        mention({
          id: 'MEN-1',
          surfaceForm: 'Pier 48',
          kindProbabilities: { location: 0.7, person: 0.1, unknown: 0.2 },
        }),
      ],
      [],
      { caseId: 'case-test' },
    );

    expect(result.entities[0]?.kind).toBe('location');
  });

  it('is deterministic across repeated runs', () => {
    const mentions = [
      mention({ id: 'MEN-1', surfaceForm: 'Dana Reyes', sourceEvidenceId: 'EV-A' }),
      mention({ id: 'MEN-2', surfaceForm: 'Dana', sourceEvidenceId: 'EV-B' }),
    ];

    expect(resolveEntities(mentions, [], { caseId: 'case-test' })).toEqual(
      resolveEntities(mentions, [], { caseId: 'case-test' }),
    );
  });

  it('records which mentions supported each entity', () => {
    const result = resolveEntities(
      [
        mention({ id: 'MEN-1', surfaceForm: 'Dana Reyes', sourceEvidenceId: 'EV-A' }),
        mention({ id: 'MEN-2', surfaceForm: 'Dana Reyes', sourceEvidenceId: 'EV-B' }),
      ],
      [],
      { caseId: 'case-test' },
    );

    expect(result.entities[0]?.properties.mentionIds).toEqual(['MEN-1', 'MEN-2']);
  });
});

describe('deriveWorldEdges', () => {
  const dana = entity({
    id: 'E-DANA',
    label: 'Dana Reyes',
    kind: 'person',
    confidence: 0.8,
  });
  const pier = entity({
    id: 'E-PIER',
    label: 'Pier 48',
    kind: 'location',
    confidence: 0.8,
  });
  const marcus = entity({
    id: 'E-MARCUS',
    label: 'Marcus Webb',
    kind: 'person',
    confidence: 0.8,
  });

  it('derives no relationship from a case with no mentions', () => {
    const result = deriveWorldEdges({
      caseId: 'case-test',
      observations: [],
      claims: [],
      entities: [dana, pier],
      mentions: [],
    });
    expect(result.edges).toEqual([]);
    expect(result.assumptions).toEqual([]);
  });

  it('places a person at a location co-observed in the same observation', () => {
    const result = deriveWorldEdges({
      caseId: 'case-test',
      observations: [observation({ id: 'O-1', text: 'Dana Reyes at Pier 48.' })],
      claims: [],
      entities: [dana, pier],
      mentions: [
        mention({
          id: 'MEN-1',
          surfaceForm: 'Dana Reyes',
          sourceRecordId: 'O-1',
          recordType: 'observation',
        }),
        mention({
          id: 'MEN-2',
          surfaceForm: 'Pier 48',
          sourceRecordId: 'O-1',
          recordType: 'observation',
        }),
      ],
    });

    const edge = result.edges.find((item) => item.predicate === 'OBSERVED_AT');
    expect(edge?.subjectId).toBe('E-DANA');
    expect(edge?.objectId).toBe('E-PIER');
    expect(edge?.sourceObservationIds).toEqual(['O-1']);
    expect(edge?.createdByAgent).toBe('linker');
  });

  it('names the leap it took as an assumption the edge depends on', () => {
    const result = deriveWorldEdges({
      caseId: 'case-test',
      observations: [observation({ id: 'O-1', text: 'Dana Reyes at Pier 48.' })],
      claims: [],
      entities: [dana, pier],
      mentions: [
        mention({
          id: 'MEN-1',
          surfaceForm: 'Dana Reyes',
          sourceRecordId: 'O-1',
          recordType: 'observation',
        }),
        mention({
          id: 'MEN-2',
          surfaceForm: 'Pier 48',
          sourceRecordId: 'O-1',
          recordType: 'observation',
        }),
      ],
    });

    const edge = result.edges[0];
    expect(edge?.assumptionIds.length).toBeGreaterThan(0);
    const assumption = result.assumptions.find(
      (item) => item.id === edge?.assumptionIds[0],
    );
    expect(assumption).toBeDefined();
    expect(assumption?.status).toBe('valid');
    expect(assumption?.detail.length).toBeGreaterThan(0);
  });

  it('rates a relationship read from testimony below the same one read from an observation', () => {
    const observed = deriveWorldEdges({
      caseId: 'case-test',
      observations: [observation({ id: 'O-1', text: 'Dana Reyes at Pier 48.' })],
      claims: [],
      entities: [dana, pier],
      mentions: [
        mention({
          id: 'MEN-1',
          surfaceForm: 'Dana Reyes',
          sourceRecordId: 'O-1',
          recordType: 'observation',
        }),
        mention({
          id: 'MEN-2',
          surfaceForm: 'Pier 48',
          sourceRecordId: 'O-1',
          recordType: 'observation',
        }),
      ],
    });
    const attested = deriveWorldEdges({
      caseId: 'case-test',
      observations: [],
      claims: [
        claim({
          id: 'C-1',
          verbatim: 'Dana Reyes was at Pier 48.',
          sourceReliability: 'D',
          informationCredibility: 4,
        }),
      ],
      entities: [dana, pier],
      mentions: [
        mention({
          id: 'MEN-1',
          surfaceForm: 'Dana Reyes',
          sourceRecordId: 'C-1',
          recordType: 'claim',
        }),
        mention({
          id: 'MEN-2',
          surfaceForm: 'Pier 48',
          sourceRecordId: 'C-1',
          recordType: 'claim',
        }),
      ],
    });

    expect(attested.edges[0]?.confidence).toBeLessThan(observed.edges[0]?.confidence ?? 0);
  });

  it('carries a claim-derived edge back to its claim, not to an observation', () => {
    const result = deriveWorldEdges({
      caseId: 'case-test',
      observations: [],
      claims: [claim({ id: 'C-1', verbatim: 'Dana Reyes was at Pier 48.' })],
      entities: [dana, pier],
      mentions: [
        mention({
          id: 'MEN-1',
          surfaceForm: 'Dana Reyes',
          sourceRecordId: 'C-1',
          recordType: 'claim',
        }),
        mention({
          id: 'MEN-2',
          surfaceForm: 'Pier 48',
          sourceRecordId: 'C-1',
          recordType: 'claim',
        }),
      ],
    });

    expect(result.edges[0]?.sourceClaimIds).toEqual(['C-1']);
    expect(result.edges[0]?.sourceObservationIds).toEqual([]);
  });

  it('never relates an entity to itself', () => {
    const result = deriveWorldEdges({
      caseId: 'case-test',
      observations: [observation({ id: 'O-1', text: 'Dana Reyes and Dana Reyes.' })],
      claims: [],
      entities: [dana],
      mentions: [
        mention({
          id: 'MEN-1',
          surfaceForm: 'Dana Reyes',
          sourceRecordId: 'O-1',
          recordType: 'observation',
        }),
        mention({
          id: 'MEN-2',
          surfaceForm: 'Dana Reyes',
          sourceRecordId: 'O-1',
          recordType: 'observation',
        }),
      ],
    });

    expect(result.edges).toEqual([]);
  });

  it('ignores a mention that never resolved to an entity', () => {
    const result = deriveWorldEdges({
      caseId: 'case-test',
      observations: [observation({ id: 'O-1', text: 'Someone at Pier 48.' })],
      claims: [],
      entities: [pier],
      mentions: [
        mention({
          id: 'MEN-1',
          surfaceForm: 'someone',
          vague: true,
          channel: 'vague',
          sourceRecordId: 'O-1',
          recordType: 'observation',
        }),
        mention({
          id: 'MEN-2',
          surfaceForm: 'Pier 48',
          sourceRecordId: 'O-1',
          recordType: 'observation',
        }),
      ],
    });

    expect(result.edges).toEqual([]);
  });

  it('records a supporting contribution for every source behind the edge', () => {
    const result = deriveWorldEdges({
      caseId: 'case-test',
      observations: [observation({ id: 'O-1', text: 'Dana Reyes at Pier 48.' })],
      claims: [],
      entities: [dana, pier],
      mentions: [
        mention({
          id: 'MEN-1',
          surfaceForm: 'Dana Reyes',
          sourceRecordId: 'O-1',
          recordType: 'observation',
        }),
        mention({
          id: 'MEN-2',
          surfaceForm: 'Pier 48',
          sourceRecordId: 'O-1',
          recordType: 'observation',
        }),
      ],
    });

    const contributions = result.edges[0]?.contributions ?? [];
    expect(contributions.length).toBeGreaterThan(0);
    expect(contributions.every((item) => item.polarity === 'support')).toBe(true);
    expect(contributions.every((item) => item.sourceId.length > 0)).toBe(true);
  });

  it('merges two artifacts supporting the same relationship into one stronger edge', () => {
    const result = deriveWorldEdges({
      caseId: 'case-test',
      observations: [
        observation({
          id: 'O-1',
          text: 'Dana Reyes at Pier 48.',
          sourceEvidenceId: 'EV-A',
        }),
        observation({
          id: 'O-2',
          text: 'Dana Reyes at Pier 48.',
          sourceEvidenceId: 'EV-B',
        }),
      ],
      claims: [],
      entities: [dana, pier],
      mentions: [
        mention({
          id: 'MEN-1',
          surfaceForm: 'Dana Reyes',
          sourceRecordId: 'O-1',
          recordType: 'observation',
          sourceEvidenceId: 'EV-A',
        }),
        mention({
          id: 'MEN-2',
          surfaceForm: 'Pier 48',
          sourceRecordId: 'O-1',
          recordType: 'observation',
          sourceEvidenceId: 'EV-A',
        }),
        mention({
          id: 'MEN-3',
          surfaceForm: 'Dana Reyes',
          sourceRecordId: 'O-2',
          recordType: 'observation',
          sourceEvidenceId: 'EV-B',
        }),
        mention({
          id: 'MEN-4',
          surfaceForm: 'Pier 48',
          sourceRecordId: 'O-2',
          recordType: 'observation',
          sourceEvidenceId: 'EV-B',
        }),
      ],
    });

    const edges = result.edges.filter((item) => item.predicate === 'OBSERVED_AT');
    expect(edges).toHaveLength(1);
    expect(edges[0]?.sourceObservationIds).toEqual(['O-1', 'O-2']);
    expect(edges[0]?.contributions.length).toBeGreaterThanOrEqual(2);
  });

  it('gives each edge the lenses its participants belong to', () => {
    const result = deriveWorldEdges({
      caseId: 'case-test',
      observations: [observation({ id: 'O-1', text: 'Dana Reyes at Pier 48.' })],
      claims: [],
      entities: [dana, pier],
      mentions: [
        mention({
          id: 'MEN-1',
          surfaceForm: 'Dana Reyes',
          sourceRecordId: 'O-1',
          recordType: 'observation',
        }),
        mention({
          id: 'MEN-2',
          surfaceForm: 'Pier 48',
          sourceRecordId: 'O-1',
          recordType: 'observation',
        }),
      ],
    });

    expect(result.edges[0]?.lenses).toEqual(expect.arrayContaining(['people', 'place']));
  });

  it('reads two people in one observation as contact rather than location', () => {
    const result = deriveWorldEdges({
      caseId: 'case-test',
      observations: [observation({ id: 'O-1', text: 'Dana Reyes and Marcus Webb.' })],
      claims: [],
      entities: [dana, marcus],
      mentions: [
        mention({
          id: 'MEN-1',
          surfaceForm: 'Dana Reyes',
          sourceRecordId: 'O-1',
          recordType: 'observation',
        }),
        mention({
          id: 'MEN-2',
          surfaceForm: 'Marcus Webb',
          sourceRecordId: 'O-1',
          recordType: 'observation',
        }),
      ],
    });

    expect(result.edges[0]?.predicate).toBe('MET_WITH');
  });

  it('is deterministic across repeated runs', () => {
    const input = {
      caseId: 'case-test',
      observations: [observation({ id: 'O-1', text: 'Dana Reyes at Pier 48.' })],
      claims: [],
      entities: [dana, pier],
      mentions: [
        mention({
          id: 'MEN-1',
          surfaceForm: 'Dana Reyes',
          sourceRecordId: 'O-1',
          recordType: 'observation',
        }),
        mention({
          id: 'MEN-2',
          surfaceForm: 'Pier 48',
          sourceRecordId: 'O-1',
          recordType: 'observation',
        }),
      ],
    };
    expect(deriveWorldEdges({ ...input, timestamp: '2026-01-01T00:00:00.000Z' })).toEqual(
      deriveWorldEdges({ ...input, timestamp: '2026-01-01T00:00:00.000Z' }),
    );
  });
});

describe('createEmptyCase', () => {
  it('starts a case with no derived content at all', () => {
    const state = createEmptyCase({ id: 'case-new', title: 'Missing shipment' });

    expect(state.metadata.id).toBe('case-new');
    expect(state.metadata.title).toBe('Missing shipment');
    expect(state.metadata.revision).toBe(0);
    expect(state.schemaVersion).toBe(1);
    expect(state.evidence).toEqual([]);
    expect(state.entities).toEqual([]);
    expect(state.worldEdges).toEqual([]);
    expect(state.reconstructions).toEqual([]);
    expect(state.anomalies).toEqual([]);
  });

  it('marks a case as real rather than synthetic unless told otherwise', () => {
    expect(createEmptyCase({ id: 'case-new', title: 'X' }).metadata.synthetic).toBe(false);
    expect(
      createEmptyCase({ id: 'case-new', title: 'X', synthetic: true }).metadata.synthetic,
    ).toBe(true);
  });
});

function caseWithPlacements(
  placements: Array<{ id: string; place: string; earliest: string; latest: string }>,
) {
  const state = createEmptyCase({ id: 'case-test', title: 'Test' });
  state.entities.push(
    entity({ id: 'E-DANA', label: 'Dana Reyes', kind: 'person', confidence: 0.8 }),
  );
  for (const placement of placements) {
    state.entities.push(
      entity({
        id: placement.place,
        label: placement.place,
        kind: 'location',
        confidence: 0.8,
      }),
    );
    state.observations.push(
      observation({
        id: `O-${placement.id}`,
        text: `Dana Reyes at ${placement.place}.`,
        sourceEvidenceId: `EV-${placement.id}`,
        interval: {
          earliest: placement.earliest,
          latest: placement.latest,
          precision: 'minute',
          confidence: 0.9,
        },
      }),
    );
    state.worldEdges.push({
      id: `WE-${placement.id}`,
      caseId: 'case-test',
      subjectId: 'E-DANA',
      predicate: 'OBSERVED_AT',
      objectId: placement.place,
      confidence: 0.7,
      sourceClaimIds: [],
      sourceObservationIds: [`O-${placement.id}`],
      contributions: [],
      validTime: {
        earliest: placement.earliest,
        latest: placement.latest,
        precision: 'minute',
        confidence: 0.9,
      },
      transactionTime: '2026-01-01T00:00:00.000Z',
      disputed: false,
      alternatives: [],
      createdByAgent: 'linker',
      assumptionIds: ['A-LEAP-CO-PRESENCE'],
      lenses: ['people', 'place'],
    });
  }
  return state;
}

describe('detectContradictions', () => {
  it('finds no contradiction in an empty case', () => {
    const result = detectContradictions(createEmptyCase({ id: 'case-test', title: 'T' }));
    expect(result.beliefs).toEqual([]);
    expect(result.disputedEdgeIds).toEqual([]);
  });

  it('flags one person in two places at an overlapping time', () => {
    const state = caseWithPlacements([
      {
        id: 'A',
        place: 'E-PIER',
        earliest: '2026-08-04T21:00:00.000Z',
        latest: '2026-08-04T21:10:00.000Z',
      },
      {
        id: 'B',
        place: 'E-WAREHOUSE',
        earliest: '2026-08-04T21:05:00.000Z',
        latest: '2026-08-04T21:15:00.000Z',
      },
    ]);

    const result = detectContradictions(state);
    expect(result.beliefs).toHaveLength(1);
    expect(result.beliefs[0]?.kind).toBe('contradiction');
    expect(result.beliefs[0]?.sourceIds).toEqual(expect.arrayContaining(['WE-A', 'WE-B']));
    expect(result.disputedEdgeIds).toEqual(expect.arrayContaining(['WE-A', 'WE-B']));
  });

  it('accepts one person in two places at clearly separate times', () => {
    const state = caseWithPlacements([
      {
        id: 'A',
        place: 'E-PIER',
        earliest: '2026-08-04T20:00:00.000Z',
        latest: '2026-08-04T20:10:00.000Z',
      },
      {
        id: 'B',
        place: 'E-WAREHOUSE',
        earliest: '2026-08-04T22:00:00.000Z',
        latest: '2026-08-04T22:10:00.000Z',
      },
    ]);

    expect(detectContradictions(state).beliefs).toEqual([]);
  });

  it('refuses to call it a contradiction when a placement has no time at all', () => {
    const state = caseWithPlacements([
      {
        id: 'A',
        place: 'E-PIER',
        earliest: '2026-08-04T21:00:00.000Z',
        latest: '2026-08-04T21:10:00.000Z',
      },
      {
        id: 'B',
        place: 'E-WAREHOUSE',
        earliest: '2026-08-04T21:05:00.000Z',
        latest: '2026-08-04T21:15:00.000Z',
      },
    ]);
    const target = state.worldEdges.find((edge) => edge.id === 'WE-B');
    if (target) target.validTime = null;

    expect(detectContradictions(state).beliefs).toEqual([]);
  });

  it('carries the assumptions behind both sides into the contradiction environment', () => {
    const state = caseWithPlacements([
      {
        id: 'A',
        place: 'E-PIER',
        earliest: '2026-08-04T21:00:00.000Z',
        latest: '2026-08-04T21:10:00.000Z',
      },
      {
        id: 'B',
        place: 'E-WAREHOUSE',
        earliest: '2026-08-04T21:05:00.000Z',
        latest: '2026-08-04T21:15:00.000Z',
      },
    ]);

    const belief = detectContradictions(state).beliefs[0];
    expect(belief?.environments.length).toBeGreaterThan(0);
    expect(belief?.environments.flat()).toContain('A-LEAP-CO-PRESENCE');
  });

  it('flags a direct denial of another speaker statement', () => {
    const state = createEmptyCase({ id: 'case-test', title: 'T' });
    state.entities.push(entity({ id: 'E-DANA', label: 'Dana Reyes', kind: 'person' }));
    state.claims.push(
      claim({
        id: 'C-1',
        speaker: 'Marcus Webb',
        verbatim: 'Dana Reyes was at the gate.',
        sourceEvidenceId: 'EV-1',
      }),
      claim({
        id: 'C-2',
        speaker: 'Ruth Sandoval',
        verbatim: 'Dana Reyes was not at the gate.',
        sourceEvidenceId: 'EV-2',
      }),
    );

    const result = detectContradictions(state);
    expect(result.beliefs).toHaveLength(1);
    expect(result.beliefs[0]?.sourceIds).toEqual(expect.arrayContaining(['C-1', 'C-2']));
  });

  it('does not treat one speaker repeating themselves as a contradiction', () => {
    const state = createEmptyCase({ id: 'case-test', title: 'T' });
    state.entities.push(entity({ id: 'E-DANA', label: 'Dana Reyes', kind: 'person' }));
    state.claims.push(
      claim({
        id: 'C-1',
        speaker: 'Marcus Webb',
        verbatim: 'Dana Reyes was at the gate.',
        sourceEvidenceId: 'EV-1',
      }),
      claim({
        id: 'C-2',
        speaker: 'Marcus Webb',
        verbatim: 'Dana Reyes was at the gate.',
        sourceEvidenceId: 'EV-1',
      }),
    );

    expect(detectContradictions(state).beliefs).toEqual([]);
  });

  it('is deterministic across repeated runs', () => {
    const state = caseWithPlacements([
      {
        id: 'A',
        place: 'E-PIER',
        earliest: '2026-08-04T21:00:00.000Z',
        latest: '2026-08-04T21:10:00.000Z',
      },
      {
        id: 'B',
        place: 'E-WAREHOUSE',
        earliest: '2026-08-04T21:05:00.000Z',
        latest: '2026-08-04T21:15:00.000Z',
      },
    ]);
    expect(detectContradictions(state)).toEqual(detectContradictions(state));
  });
});

describe('abduceHypotheses', () => {
  function contradictedCase() {
    return caseWithPlacements([
      {
        id: 'A',
        place: 'E-PIER',
        earliest: '2026-08-04T21:00:00.000Z',
        latest: '2026-08-04T21:10:00.000Z',
      },
      {
        id: 'B',
        place: 'E-WAREHOUSE',
        earliest: '2026-08-04T21:05:00.000Z',
        latest: '2026-08-04T21:15:00.000Z',
      },
    ]);
  }

  it('proposes nothing to explain in a case with no tension and no open identity', () => {
    const result = abduceHypotheses(createEmptyCase({ id: 'case-test', title: 'T' }));
    expect(result.beliefs).toEqual([]);
    expect(result.beliefEdges).toEqual([]);
  });

  it('offers competing explanations for a contradiction rather than picking one', () => {
    const state = contradictedCase();
    state.beliefs.push(...detectContradictions(state).beliefs);

    const result = abduceHypotheses(state);
    const hypotheses = result.beliefs.filter(
      (belief) => belief.kind === 'hypothesis' || belief.kind === 'alternative-explanation',
    );
    expect(hypotheses.length).toBeGreaterThanOrEqual(3);
    // Competing explanations partition the probability mass; none is asserted.
    const total = hypotheses.reduce((sum, belief) => sum + belief.confidence, 0);
    expect(total).toBeCloseTo(1, 1);
    expect(hypotheses.every((belief) => belief.status === 'open')).toBe(true);
  });

  it('links every explanation to the contradiction it would resolve', () => {
    const state = contradictedCase();
    const contradictions = detectContradictions(state).beliefs;
    state.beliefs.push(...contradictions);

    const result = abduceHypotheses(state);
    const explains = result.beliefEdges.filter((edge) => edge.predicate === 'EXPLAINS');
    expect(explains.length).toBeGreaterThan(0);
    expect(explains.every((edge) => edge.targetId === contradictions[0]?.id)).toBe(true);
  });

  it('marks competing explanations as contradicting each other', () => {
    const state = contradictedCase();
    state.beliefs.push(...detectContradictions(state).beliefs);

    const result = abduceHypotheses(state);
    expect(result.beliefEdges.some((edge) => edge.predicate === 'CONTRADICTS')).toBe(true);
  });

  it('offers one explanation per candidate binding of an open identity', () => {
    const state = createEmptyCase({ id: 'case-test', title: 'T' });
    state.entities.push(
      entity({ id: 'E-DANA', label: 'Dana Reyes' }),
      entity({ id: 'E-DEE', label: 'Dana Whitlock' }),
    );
    state.unresolvedReferences.push({
      id: 'U-DANA',
      caseId: 'case-test',
      surfaceForm: 'Dana',
      context: '',
      kindProbabilities: { person: 1 },
      candidateBindings: [
        {
          entityId: 'E-DANA',
          label: 'Dana Reyes',
          probability: 0.5,
          prior: 0.5,
          signalIds: [],
        },
        {
          entityId: 'E-DEE',
          label: 'Dana Whitlock',
          probability: 0.3,
          prior: 0.3,
          signalIds: [],
        },
        {
          entityId: null,
          label: 'Someone else',
          probability: 0.2,
          prior: 0.2,
          signalIds: [],
        },
      ],
      resolutionSignals: [],
      status: 'candidate',
      resolvedBy: null,
      sourceEvidenceIds: ['EV-1'],
    });

    const result = abduceHypotheses(state);
    const identity = result.beliefs.filter((belief) => belief.sourceIds.includes('U-DANA'));
    expect(identity.length).toBeGreaterThanOrEqual(2);
    expect(identity.some((belief) => belief.label.includes('Dana Reyes'))).toBe(true);
    expect(identity.some((belief) => belief.label.includes('Dana Whitlock'))).toBe(true);
  });

  it('is deterministic across repeated runs', () => {
    const state = contradictedCase();
    state.beliefs.push(...detectContradictions(state).beliefs);
    expect(abduceHypotheses(state)).toEqual(abduceHypotheses(state));
  });
});

describe('rankOpenQuestions', () => {
  it('asks nothing about an empty case', () => {
    expect(rankOpenQuestions(createEmptyCase({ id: 'case-test', title: 'T' }))).toEqual([]);
  });

  it('asks who an unresolved reference is', () => {
    const state = createEmptyCase({ id: 'case-test', title: 'T' });
    state.unresolvedReferences.push({
      id: 'U-J',
      caseId: 'case-test',
      surfaceForm: 'J',
      context: '',
      kindProbabilities: { person: 1 },
      candidateBindings: [
        { entityId: 'E-A', label: 'Alice', probability: 0.5, prior: 0.5, signalIds: [] },
        { entityId: 'E-B', label: 'Bob', probability: 0.5, prior: 0.5, signalIds: [] },
      ],
      resolutionSignals: [],
      status: 'candidate',
      resolvedBy: null,
      sourceEvidenceIds: ['EV-1'],
    });

    const questions = rankOpenQuestions(state);
    expect(questions).toHaveLength(1);
    expect(questions[0]?.category).toBe('who');
    expect(questions[0]?.relatedIds).toContain('U-J');
    expect(questions[0]?.status).toBe('open');
    expect(questions[0]?.expectedInformationGain).toBeGreaterThan(0);
  });

  it('ranks an evenly split identity above a nearly settled one', () => {
    function stateWith(probabilities: [number, number]) {
      const state = createEmptyCase({ id: 'case-test', title: 'T' });
      state.unresolvedReferences.push({
        id: 'U-X',
        caseId: 'case-test',
        surfaceForm: 'X',
        context: '',
        kindProbabilities: { person: 1 },
        candidateBindings: [
          {
            entityId: 'E-A',
            label: 'Alice',
            probability: probabilities[0],
            prior: probabilities[0],
            signalIds: [],
          },
          {
            entityId: 'E-B',
            label: 'Bob',
            probability: probabilities[1],
            prior: probabilities[1],
            signalIds: [],
          },
        ],
        resolutionSignals: [],
        status: 'candidate',
        resolvedBy: null,
        sourceEvidenceIds: ['EV-1'],
      });
      return state;
    }

    const split = rankOpenQuestions(stateWith([0.5, 0.5]))[0];
    const settled = rankOpenQuestions(stateWith([0.95, 0.05]))[0];
    expect(split?.expectedInformationGain).toBeGreaterThan(
      settled?.expectedInformationGain ?? 1,
    );
  });

  it('asks which side of a contradiction is wrong', () => {
    const state = caseWithPlacements([
      {
        id: 'A',
        place: 'E-PIER',
        earliest: '2026-08-04T21:00:00.000Z',
        latest: '2026-08-04T21:10:00.000Z',
      },
      {
        id: 'B',
        place: 'E-WAREHOUSE',
        earliest: '2026-08-04T21:05:00.000Z',
        latest: '2026-08-04T21:15:00.000Z',
      },
    ]);
    state.beliefs.push(...detectContradictions(state).beliefs);

    const questions = rankOpenQuestions(state);
    expect(questions.some((item) => item.relatedIds.includes('WE-A'))).toBe(true);
  });

  it('asks for corroboration of a relationship resting on a single artifact', () => {
    const state = caseWithPlacements([
      {
        id: 'A',
        place: 'E-PIER',
        earliest: '2026-08-04T21:00:00.000Z',
        latest: '2026-08-04T21:10:00.000Z',
      },
    ]);

    const questions = rankOpenQuestions(state);
    expect(
      questions.some((item) => item.detail.toLowerCase().includes('one artifact')),
    ).toBe(true);
  });

  it('returns questions ordered by expected information gain', () => {
    const state = caseWithPlacements([
      {
        id: 'A',
        place: 'E-PIER',
        earliest: '2026-08-04T21:00:00.000Z',
        latest: '2026-08-04T21:10:00.000Z',
      },
      {
        id: 'B',
        place: 'E-WAREHOUSE',
        earliest: '2026-08-04T21:05:00.000Z',
        latest: '2026-08-04T21:15:00.000Z',
      },
    ]);
    state.beliefs.push(...detectContradictions(state).beliefs);

    const gains = rankOpenQuestions(state).map((item) => item.expectedInformationGain);
    expect(gains).toEqual([...gains].sort((a, b) => b - a));
  });
});

describe('deriveTemporalConstraints', () => {
  it('derives nothing without timed records', () => {
    expect(
      deriveTemporalConstraints(createEmptyCase({ id: 'c', title: 'T' })).constraints,
    ).toEqual([]);
  });

  it('relates two timed observations and reports the network consistent', () => {
    const state = caseWithPlacements([
      {
        id: 'A',
        place: 'E-PIER',
        earliest: '2026-08-04T20:00:00.000Z',
        latest: '2026-08-04T20:10:00.000Z',
      },
      {
        id: 'B',
        place: 'E-WAREHOUSE',
        earliest: '2026-08-04T21:00:00.000Z',
        latest: '2026-08-04T21:10:00.000Z',
      },
    ]);

    const result = deriveTemporalConstraints(state);
    expect(result.constraints).toHaveLength(1);
    expect(result.constraints[0]?.possibleRelations).toContain('before');
    expect(result.consistent).toBe(true);
    expect(result.constraints[0]?.sourceIds.length).toBeGreaterThan(0);
  });
});

describe('buildReconstructions', () => {
  it('reconstructs nothing from an empty case', () => {
    expect(buildReconstructions(createEmptyCase({ id: 'c', title: 'T' }))).toEqual([]);
  });

  it('produces one account when nothing is in tension', () => {
    const state = caseWithPlacements([
      {
        id: 'A',
        place: 'E-PIER',
        earliest: '2026-08-04T21:00:00.000Z',
        latest: '2026-08-04T21:10:00.000Z',
      },
    ]);

    const reconstructions = buildReconstructions(state);
    expect(reconstructions).toHaveLength(1);
    expect(reconstructions[0]?.isLeading).toBe(true);
    expect(reconstructions[0]?.statements.length).toBeGreaterThan(0);
    expect(reconstructions[0]?.coveragePercent).toBeGreaterThanOrEqual(0);
    expect(reconstructions[0]?.coveragePercent).toBeLessThanOrEqual(100);
  });

  it('produces competing accounts when a contradiction is open', () => {
    const state = caseWithPlacements([
      {
        id: 'A',
        place: 'E-PIER',
        earliest: '2026-08-04T21:00:00.000Z',
        latest: '2026-08-04T21:10:00.000Z',
      },
      {
        id: 'B',
        place: 'E-WAREHOUSE',
        earliest: '2026-08-04T21:05:00.000Z',
        latest: '2026-08-04T21:15:00.000Z',
      },
    ]);
    state.beliefs.push(...detectContradictions(state).beliefs);
    state.beliefs.push(...abduceHypotheses(state).beliefs);

    const reconstructions = buildReconstructions(state);
    expect(reconstructions.length).toBeGreaterThanOrEqual(2);
    expect(reconstructions.filter((item) => item.isLeading)).toHaveLength(1);
    expect(reconstructions.map((item) => item.rank)).toEqual(
      reconstructions.map((_, index) => index + 1),
    );
  });

  it('never calls a statement SUPPORTED on the strength of a single artifact', () => {
    const state = caseWithPlacements([
      {
        id: 'A',
        place: 'E-PIER',
        earliest: '2026-08-04T21:00:00.000Z',
        latest: '2026-08-04T21:10:00.000Z',
      },
    ]);

    const statements = buildReconstructions(state).flatMap((item) => item.statements);
    expect(statements.length).toBeGreaterThan(0);
    expect(statements.every((statement) => statement.status !== 'SUPPORTED')).toBe(true);
  });

  it('labels every statement with a support status and its sources', () => {
    const state = caseWithPlacements([
      {
        id: 'A',
        place: 'E-PIER',
        earliest: '2026-08-04T21:00:00.000Z',
        latest: '2026-08-04T21:10:00.000Z',
      },
    ]);

    for (const statement of buildReconstructions(state).flatMap(
      (item) => item.statements,
    )) {
      expect([
        'SUPPORTED',
        'PARTIALLY_SUPPORTED',
        'INFERRED',
        'DISPUTED',
        'UNKNOWN',
      ]).toContain(statement.status);
      expect(statement.sourceIds.length).toBeGreaterThan(0);
    }
  });
});

describe('runInferencePass', () => {
  function caseWithRawRecords() {
    const state = createEmptyCase({ id: 'case-test', title: 'Warehouse' });
    state.evidence.push({
      id: 'EV-1',
      caseId: 'case-test',
      title: 'Gate log',
      kind: 'access-log',
      fileName: 'gate.txt',
      mimeType: 'text/plain',
      sha256: 'a'.repeat(64),
      ingestedAt: '2026-08-04T00:00:00.000Z',
      capturedAt: null,
      sourceLabel: 'Gate system',
      chainOfCustody: 'test',
      content: 'Dana Reyes at Pier 48.',
      rawLocator: null,
      extractionStatus: 'bounded-local',
      extractor: 'local-deterministic',
      observationIds: ['O-1'],
      claimIds: [],
      synthetic: false,
      challengedByEvidenceIds: [],
    });
    state.observations.push(
      observation({ id: 'O-1', text: 'Dana Reyes at Pier 48.', sourceEvidenceId: 'EV-1' }),
    );
    state.claims.push(
      claim({
        id: 'C-1',
        speaker: 'Marcus Webb',
        verbatim: 'Dana Reyes was at Pier 48 that night.',
        sourceEvidenceId: 'EV-1',
      }),
    );
    return state;
  }

  it('changes nothing in an empty case', () => {
    const result = runInferencePass(createEmptyCase({ id: 'c', title: 'T' }), {
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(result.revision).toBeNull();
    expect(result.state.entities).toEqual([]);
  });

  it('builds a graph from raw records that had none', () => {
    const result = runInferencePass(caseWithRawRecords(), {
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    expect(result.revision).not.toBeNull();
    expect(result.state.entities.length).toBeGreaterThan(0);
    expect(result.state.worldEdges.length).toBeGreaterThan(0);
    expect(result.state.entities.some((item) => item.label === 'Dana Reyes')).toBe(true);
    expect(result.state.entities.some((item) => item.label === 'Pier 48')).toBe(true);
  });

  it('is idempotent: a second pass over the same records changes nothing', () => {
    const first = runInferencePass(caseWithRawRecords(), {
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    const second = runInferencePass(first.state, { timestamp: '2026-01-01T00:00:00.000Z' });

    expect(second.revision).toBeNull();
    expect(second.state.entities).toEqual(first.state.entities);
    expect(second.state.worldEdges).toEqual(first.state.worldEdges);
  });

  it('never leaves a derived relationship without a stated assumption', () => {
    const result = runInferencePass(caseWithRawRecords(), {
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    for (const edge of result.state.worldEdges) {
      expect(edge.assumptionIds.length).toBeGreaterThan(0);
      for (const assumptionId of edge.assumptionIds) {
        expect(result.state.assumptions.some((item) => item.id === assumptionId)).toBe(
          true,
        );
      }
    }
  });

  it('records what each stage did in the audit trail', () => {
    const result = runInferencePass(caseWithRawRecords(), {
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    expect(result.auditSteps.length).toBeGreaterThan(0);
    expect(result.auditSteps.join(' ')).toMatch(/RESOLVER/);
    expect(result.auditSteps.join(' ')).toMatch(/LINKER/);
  });

  it('does not mutate the state it was given', () => {
    const original = caseWithRawRecords();
    const snapshot = structuredClone(original);
    runInferencePass(original, { timestamp: '2026-01-01T00:00:00.000Z' });
    expect(original).toEqual(snapshot);
  });

  it('stays within its budget on a large corpus and says which bound it took', () => {
    const state = createEmptyCase({ id: 'case-big', title: 'Big' });
    for (let index = 0; index < 400; index += 1) {
      state.observations.push(
        observation({
          id: `O-${index}`,
          text: `Subject ${index} met Marcus Webb at Pier 48.`,
          sourceEvidenceId: `EV-${index % 7}`,
        }),
      );
    }

    const result = runInferencePass(state, {
      timestamp: '2026-01-01T00:00:00.000Z',
      maxRecords: 50,
    });

    expect(result.auditSteps.join(' ')).toMatch(/50 of 400/);
    expect(result.state.entities.length).toBeGreaterThan(0);
  });

  it('promotes no world fact from a claim without recording the testimony leap', () => {
    const state = createEmptyCase({ id: 'case-test', title: 'T' });
    state.claims.push(
      claim({
        id: 'C-1',
        speaker: 'Marcus Webb',
        verbatim: 'Dana Reyes was at Pier 48.',
        sourceEvidenceId: 'EV-1',
      }),
    );

    const result = runInferencePass(state, { timestamp: '2026-01-01T00:00:00.000Z' });
    const claimEdges = result.state.worldEdges.filter(
      (edge) => edge.sourceClaimIds.length > 0,
    );
    expect(claimEdges.length).toBeGreaterThan(0);
    expect(
      claimEdges.every((edge) => edge.assumptionIds.includes('A-LEAP-TESTIMONY')),
    ).toBe(true);
  });
});

describe('extractTemporalInterval', () => {
  it('reads a full ISO timestamp as an exact instant', () => {
    const interval = extractTemporalInterval('Gate opened at 2026-08-04T21:06:14Z.', null);
    expect(interval?.precision).toBe('exact');
    expect(interval?.earliest).toBe(interval?.latest);
    expect(Date.parse(interval?.earliest ?? '')).not.toBeNaN();
  });

  it('reads a date and clock time together', () => {
    const interval = extractTemporalInterval('On 2026-08-04 at 21:06 the van left.', null);
    expect(interval?.precision).toBe('minute');
    expect(interval?.earliest.startsWith('2026-08-04')).toBe(true);
  });

  it('refuses a bare clock time when no date anchors it', () => {
    // Choosing a day for "21:06" would be inventing precision the source lacks.
    expect(extractTemporalInterval('He left at 21:06.', null)).toBeNull();
  });

  it('anchors a bare clock time to the artifact capture date when one exists', () => {
    const interval = extractTemporalInterval('He left at 21:06.', {
      earliest: '2026-08-04T00:00:00.000Z',
      latest: '2026-08-04T23:59:59.000Z',
      precision: 'day',
      confidence: 1,
    });
    expect(interval?.earliest.startsWith('2026-08-04')).toBe(true);
    expect(interval?.precision).toBe('minute');
  });

  it('reads a date with no time as a whole-day range', () => {
    const interval = extractTemporalInterval('Filed on 2026-08-04.', null);
    expect(interval?.precision).toBe('day');
    expect(interval?.earliest).not.toBe(interval?.latest);
  });

  it('finds no time in text that has none', () => {
    expect(extractTemporalInterval('The pallet was heavy.', null)).toBeNull();
  });
});

describe('runInferencePass temporal enrichment', () => {
  function timedCase() {
    const state = createEmptyCase({ id: 'case-timed', title: 'Timed' });
    state.evidence.push({
      id: 'EV-1',
      caseId: 'case-timed',
      title: 'Log',
      kind: 'access-log',
      fileName: 'log.txt',
      mimeType: 'text/plain',
      sha256: 'b'.repeat(64),
      ingestedAt: '2026-08-05T00:00:00.000Z',
      capturedAt: null,
      sourceLabel: 'Gate',
      chainOfCustody: 'test',
      content: null,
      rawLocator: null,
      extractionStatus: 'bounded-local',
      extractor: 'local-deterministic',
      observationIds: [],
      claimIds: ['C-1', 'C-2'],
      synthetic: false,
      challengedByEvidenceIds: [],
    });
    state.claims.push(
      claim({
        id: 'C-1',
        speaker: 'Camera 4',
        verbatim: 'Dana Reyes at Warehouse A on 2026-08-04T21:06:00Z.',
        sourceEvidenceId: 'EV-1',
      }),
      claim({
        id: 'C-2',
        speaker: 'Camera 9',
        verbatim: 'Dana Reyes at Pier 48 on 2026-08-04T21:06:30Z.',
        sourceEvidenceId: 'EV-1',
      }),
    );
    return state;
  }

  it('fills a claim interval from a timestamp inside its own text', () => {
    const result = runInferencePass(timedCase(), {
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    const enriched = result.state.claims.find((item) => item.id === 'C-1');
    expect(enriched?.interval).not.toBeNull();
    expect(enriched?.interval?.earliest.startsWith('2026-08-04')).toBe(true);
  });

  it('carries the parsed time onto the relationship it supports', () => {
    const result = runInferencePass(timedCase(), {
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    const placed = result.state.worldEdges.filter(
      (edge) => edge.predicate === 'OBSERVED_AT' && edge.validTime !== null,
    );
    expect(placed.length).toBeGreaterThan(0);
  });

  it('finds the contradiction two timed artifacts create between them', () => {
    const result = runInferencePass(timedCase(), {
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    const contradictions = result.state.beliefs.filter(
      (belief) => belief.kind === 'contradiction',
    );
    expect(contradictions.length).toBeGreaterThan(0);
    expect(result.state.reconstructions.length).toBeGreaterThanOrEqual(2);
  });

  it('stays idempotent once the intervals are filled', () => {
    const first = runInferencePass(timedCase(), { timestamp: '2026-01-01T00:00:00.000Z' });
    const second = runInferencePass(first.state, {
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(second.revision).toBeNull();
  });
});
