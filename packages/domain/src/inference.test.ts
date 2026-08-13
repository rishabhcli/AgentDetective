import { describe, expect, it } from 'vitest';
import { extractEntityMentions, resolveEntities, type EntityMention } from './inference.js';
import type { Claim, Entity, Observation } from './types.js';

function mention(partial: Partial<EntityMention> & { id: string; surfaceForm: string }): EntityMention {
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

function observation(partial: Partial<Observation> & { id: string; text: string }): Observation {
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

    const org = mentions.find((mention) => mention.surfaceForm.startsWith('Harbor Freight'));
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

  it('is deterministic: the same records produce the same mention IDs in the same order', () => {
    const records = [claim({ id: 'C-1', verbatim: 'Marcus Webb met Dana Reyes at Pier 48.' })];

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
      expect(mention.sourceRecordId === 'O-9' || mention.sourceRecordId === 'C-9').toBe(true);
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
    const bound = reference?.candidateBindings.filter((item) => item.entityId !== null) ?? [];
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
