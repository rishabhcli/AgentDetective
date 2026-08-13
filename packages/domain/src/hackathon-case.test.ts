import { describe, expect, it } from 'vitest';
import { createHackathonCase, hackathonCaseId } from './hackathon-case.js';

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

describe('privacy-safe sponsor-prize case', () => {
  it('ships as an anonymized real case rather than a synthetic allegation', () => {
    const state = createHackathonCase();

    expect(state.metadata).toMatchObject({
      id: hackathonCaseId,
      title: 'The missing sponsor prize',
      synthetic: false,
      revision: 1,
    });
    expect(state.metadata.classification).toContain('ANONYMIZED REAL CASE');
    expect(state.evidence).toHaveLength(10);
    expect(
      state.evidence.every(
        (item) =>
          !item.synthetic &&
          item.extractor === 'redacted-case-derivative' &&
          item.rawLocator === null,
      ),
    ).toBe(true);
  });

  it('keeps each privacy-safe derivative content-addressed', async () => {
    const state = createHackathonCase();

    for (const artifact of state.evidence) {
      expect(artifact.content).not.toBeNull();
      expect(await sha256(artifact.content!)).toBe(artifact.sha256);
    }
  });

  it('retains party claims, observations, and qualified world links separately', () => {
    const state = createHackathonCase();
    const organizerClaim = state.claims.find((item) => item.id === 'C-H01-ORGANIZER');
    const capturedObservation = state.observations.find(
      (item) => item.id === 'O-H01-THREAD',
    );
    const mentionEdge = state.worldEdges.find(
      (item) => item.id === 'WE-H-ORGANIZER-CLAIMED',
    );

    expect(organizerClaim?.proposition).toContain('different person');
    expect(capturedObservation?.locator).toContain('organizer statement');
    expect(mentionEdge).toMatchObject({
      predicate: 'MENTIONS',
      disputed: true,
      sourceClaimIds: ['C-H01-ORGANIZER'],
    });
    expect(mentionEdge?.predicate).not.toBe('IS_SAME_AS');
  });

  it('preserves the falsification result instead of forcing the insider theory', () => {
    const state = createHackathonCase();
    const identityLead = state.worldEdges.find((item) => item.id === 'WE-H-CLAIMED-CORE');
    const insiderAccount = state.beliefs.find((item) => item.id === 'B-R-H-INSIDER');

    expect(identityLead).toMatchObject({
      predicate: 'MAY_BE_SAME_AS',
      confidence: 0.2,
      disputed: true,
    });
    expect(insiderAccount).toMatchObject({ status: 'weakened', confidence: 0.18 });
    expect(insiderAccount?.sourceIds).toContain('EV-H09');
  });

  it('includes the inspectable imported Aside mission and leaves decisive gaps open', () => {
    const state = createHackathonCase();
    const mission = state.missions[0];

    expect(mission).toMatchObject({
      id: 'MISSION-ASIDE-IMPORT',
      initiatedBy: 'imported-run',
      scope: 'connected',
      status: 'completed',
      resultSessionId: 'RESEARCH-ASIDE-IMPORT',
    });
    expect(mission?.steps).toHaveLength(4);
    expect(state.researchSessions[0]?.limitations.join(' ')).toContain(
      'privacy-safe derivative',
    );
    expect(state.anomalies.some((item) => item.status === 'open')).toBe(true);
    expect(
      state.reconstructions.some((item) =>
        item.statements.some((statement) => statement.status === 'UNKNOWN'),
      ),
    ).toBe(true);
  });
});
