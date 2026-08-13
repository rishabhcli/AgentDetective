import { describe, expect, it } from 'vitest';
import { createHackathonCase, createSampleCase, validateCaseIntegrity } from './index.js';

describe('case integrity gate', () => {
  it('accepts both bundled cases only when their lineage is intact', () => {
    expect(validateCaseIntegrity(createSampleCase())).toMatchObject({ ok: true });
    expect(validateCaseIntegrity(createHackathonCase())).toMatchObject({ ok: true });
  });

  it('rejects an authored fixture presented as real evidence', () => {
    const state = createSampleCase();
    state.evidence[0]!.synthetic = false;

    const report = validateCaseIntegrity(state);
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'UNLABELED_FIXTURE',
          objectId: state.evidence[0]!.id,
        }),
      ]),
    );
  });

  it('rejects an evidence backlink after its observation is removed', () => {
    const state = createSampleCase();
    const observationId = state.evidence[0]!.observationIds[0]!;
    state.observations = state.observations.filter((item) => item.id !== observationId);

    const report = validateCaseIntegrity(state);
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DANGLING_ARTIFACT_OBSERVATION',
          objectId: state.evidence[0]!.id,
        }),
      ]),
    );
  });
});
