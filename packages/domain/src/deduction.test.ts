import { describe, expect, it } from 'vitest';
import {
  buildDeductionChains,
  findEvidentialSilences,
  rankKeystoneAssumptions,
} from './deduction.js';
import { applyCounterEvidence } from './reasoning.js';
import { createSampleCase } from './sample-case.js';

describe('deduction chains', () => {
  it('separates what was observed from what was merely stated', () => {
    const chains = buildDeductionChains(createSampleCase());
    const chain = chains.find((item) => item.edgeId === 'WE-JORDAN-WAREHOUSE');
    expect(chain).toBeDefined();

    const observed = chain?.rungs.filter((rung) => rung.kind === 'observed') ?? [];
    const attested = chain?.rungs.filter((rung) => rung.kind === 'attested') ?? [];
    expect(observed.length).toBeGreaterThan(0);
    expect(attested.length).toBeGreaterThan(0);

    // Testimony must carry its speaker and reliability rather than being folded
    // into the observation record.
    expect(attested.every((rung) => rung.detail.length > 0)).toBe(true);
    expect(observed.every((rung) => rung.sourceIds.length >= 2)).toBe(true);
  });

  it('names the leap and states what would destroy the conclusion', () => {
    const chains = buildDeductionChains(createSampleCase());
    const chain = chains.find((item) => item.edgeId === 'WE-JORDAN-WAREHOUSE');

    expect(chain?.rungs.some((rung) => rung.kind === 'assumed')).toBe(true);
    expect(chain?.breaksIf.length).toBeGreaterThan(0);
    expect(chain?.alternatives.length).toBeGreaterThan(0);
    expect(chain?.rungs.at(-1)?.kind).toBe('concluded');
  });

  it('keeps opposing contributions inside the chain instead of discarding them', () => {
    const chains = buildDeductionChains(createSampleCase());
    const chain = chains.find((item) => item.edgeId === 'WE-JORDAN-WAREHOUSE');
    const opposed = chain?.rungs.filter((rung) => rung.kind === 'opposed') ?? [];

    expect(opposed.length).toBeGreaterThan(0);
    expect(opposed.every((rung) => rung.contested)).toBe(true);
  });

  it('caps a chain at the first warrant that is already in doubt', () => {
    const before = createSampleCase();
    const after = applyCounterEvidence(before).state;

    const chainBefore = buildDeductionChains(before).find(
      (item) => item.edgeId === 'WE-JORDAN-WAREHOUSE',
    );
    const chainAfter = buildDeductionChains(after).find(
      (item) => item.edgeId === 'WE-JORDAN-WAREHOUSE',
    );

    // A-19 is invalidated by Evidence 143, so it becomes the limiting rung.
    expect(chainAfter?.weakestRungId).toContain('A-19');
    expect(chainAfter?.confidence).toBeLessThan(chainBefore?.confidence ?? 1);
    expect(
      chainAfter?.rungs.some((rung) => rung.kind === 'assumed' && rung.contested),
    ).toBe(true);
  });

  it('orders chains by the material weight they actually carry', () => {
    const chains = buildDeductionChains(createSampleCase());
    const weights = chains.map((chain) => chain.materialWeight);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
  });
});

describe('keystone assumptions', () => {
  it('ranks the assumption that would collapse the most of the case', () => {
    const keystones = rankKeystoneAssumptions(createSampleCase());
    expect(keystones.length).toBeGreaterThan(0);

    const top = keystones[0];
    expect(top).toBeDefined();
    expect(top!.dependentEdgeIds.length + top!.dependentBeliefIds.length).toBeGreaterThan(
      0,
    );
    expect(top!.load).toBeGreaterThan(0);
    expect(top!.load).toBeLessThanOrEqual(1);
  });

  it('reports an invalidated assumption with its real status', () => {
    const after = applyCounterEvidence(createSampleCase()).state;
    const keystone = rankKeystoneAssumptions(after).find((item) => item.id === 'A-19');
    expect(keystone?.status).toBe('invalid');
  });
});

describe('evidential silences', () => {
  it('names a relationship that rests on a single artifact', () => {
    const silences = findEvidentialSilences(createSampleCase());
    const singleSource = silences.filter((item) => item.kind === 'single-source');

    expect(singleSource.length).toBeGreaterThan(0);
    expect(singleSource[0]?.detail).toContain('corroboration');
  });

  it('treats an unresolved identity as a spread rather than a name', () => {
    const silences = findEvidentialSilences(createSampleCase());
    const identity = silences.find((item) => item.subjectId === 'U-J');

    expect(identity?.kind).toBe('unresolved-identity');
    expect(identity?.detail).toMatch(/distribution and not a name/);
    expect(identity?.exposure).toBeGreaterThan(0);
  });

  it('orders silences by how much currently rests on them', () => {
    const exposures = findEvidentialSilences(createSampleCase()).map(
      (item) => item.exposure,
    );
    expect([...exposures].sort((a, b) => b - a)).toEqual(exposures);
  });
});
