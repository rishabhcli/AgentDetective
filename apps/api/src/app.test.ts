import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import type { ConnectedResearchAdapter } from './connected-research.js';
import { JsonCaseStore } from './store.js';

describe('THREAD API', () => {
  let directory: string;
  let store: JsonCaseStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'thread-api-'));
    store = new JsonCaseStore(directory);
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('reports the actual local runtime and seeded case', async () => {
    const app = createApp({
      store,
      environment: {},
      uploadDirectory: join(directory, 'uploads'),
    });
    const health = await request(app).get('/api/health').expect(200);
    expect(health.body).toMatchObject({
      ok: true,
      storageMode: 'local-json',
      engineLabel: 'Local evidence engine',
    });
    expect(
      health.body.integrations.every((item: { active: boolean }) => !item.active),
    ).toBe(true);

    const cases = await request(app).get('/api/cases').expect(200);
    expect(cases.body.cases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'case-badge-17', synthetic: true }),
        expect.objectContaining({
          id: 'case-sponsor-prize-dispute',
          synthetic: false,
        }),
      ]),
    );
    expect(cases.body.cases).toHaveLength(2);

    const response = await request(app).get('/api/cases/case-badge-17').expect(200);
    expect(response.body.state.metadata.title).toBe('The Badge 17 discrepancy');
    expect(response.body.state.evidence).toHaveLength(10);
  });

  it('serves the anonymized Aside-derived case without exposing raw locators', async () => {
    const app = createApp({
      store,
      environment: {},
      uploadDirectory: join(directory, 'uploads'),
    });
    const response = await request(app)
      .get('/api/cases/case-sponsor-prize-dispute')
      .expect(200);

    expect(response.body.state.metadata).toMatchObject({
      title: 'The missing sponsor prize',
      synthetic: false,
      revision: 1,
    });
    expect(response.body.state.evidence).toHaveLength(10);
    expect(
      response.body.state.evidence.every(
        (item: { extractor: string; rawLocator: string | null }) =>
          item.extractor === 'redacted-case-derivative' && item.rawLocator === null,
      ),
    ).toBe(true);
    expect(response.body.state.missions[0]).toMatchObject({
      id: 'MISSION-ASIDE-IMPORT',
      initiatedBy: 'imported-run',
      status: 'completed',
    });
  });

  it('persists identity investigation and procedural memory', async () => {
    const app = createApp({
      store,
      environment: {},
      uploadDirectory: join(directory, 'uploads'),
    });
    const mutation = await request(app)
      .post('/api/cases/case-badge-17/investigations/AN-J')
      .expect(200);
    expect(mutation.body.revision.title).toContain('Who is “J”');
    expect(mutation.body.state.proceduralMemory).toHaveLength(1);

    const persisted = await request(app).get('/api/cases/case-badge-17').expect(200);
    expect(persisted.body.state.proceduralMemory[0].utilityScore).toBe(0.87);
  });

  it('turns a natural-language question into a persisted, inspectable local research run', async () => {
    const app = createApp({
      store,
      environment: {},
      uploadDirectory: join(directory, 'uploads'),
    });
    const response = await request(app)
      .post('/api/cases/case-badge-17/research')
      .send({
        question: 'Who most likely used Badge C17, and what would disprove it?',
        scope: 'case',
      })
      .expect(200);

    expect(response.body.session).toMatchObject({
      scope: 'case',
      provider: 'deterministic',
      answerStatus: 'bounded-answer',
    });
    expect(response.body.session.findings.length).toBeGreaterThanOrEqual(2);
    expect(response.body.session.surfaceChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ surface: 'case-evidence', status: 'found' }),
        expect.objectContaining({ surface: 'case-graph', status: 'found' }),
      ]),
    );
    expect(response.body.session.negativeFindings.length).toBeGreaterThan(0);
    expect(response.body.state.researchSessions[0].id).toBe(response.body.session.id);
    expect(response.body.state.proceduralMemory[0].anomalyId).toBe(
      response.body.session.id,
    );
    expect(response.body.state.beliefMemory[0].subjectId).toBe(response.body.session.id);
    expect(response.body.state.worldEdges).toHaveLength(10);
    expect(response.body.run.packetId).toBe(response.body.packet.id);
    expect(
      response.body.run.steps.find((step: { agent: string }) => step.agent === 'LINKER')
        .detail,
    ).toContain('provenance-bearing relationship');
    const packet = response.body.packet as {
      semanticMatchIds: string[];
      observationIds: string[];
      retrievalHits: Array<{ matchedBy: string[]; observationId: string }>;
    };
    expect(packet.semanticMatchIds).toEqual([]);
    expect(packet.retrievalHits.length).toBeGreaterThan(0);
    expect(
      packet.retrievalHits.every(
        (hit) =>
          packet.observationIds.includes(hit.observationId) &&
          !hit.matchedBy.includes('semantic'),
      ),
    ).toBe(true);
  });

  it('does not mutate an unrelated open question to make a mission look busy', async () => {
    const app = createApp({
      store,
      environment: {},
      uploadDirectory: join(directory, 'uploads'),
    });
    const response = await request(app)
      .post('/api/cases/case-badge-17/missions')
      .send({
        instruction: 'Find checksum corruption in the imported archive.',
        scope: 'case',
      })
      .expect(200);

    expect(response.body.state.metadata.revision).toBe(1);
    expect(
      response.body.state.anomalies.find((item: { id: string }) => item.id === 'AN-J')
        .status,
    ).toBe('open');
    expect(response.body.mission.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: 'investigate-anomaly',
          status: 'skipped',
          detail: expect.stringContaining('no unrelated case transform ran'),
        }),
      ]),
    );
  });

  it('plans and persists an outcome-oriented mission before returning its result', async () => {
    const app = createApp({
      store,
      environment: {},
      uploadDirectory: join(directory, 'uploads'),
    });
    const response = await request(app)
      .post('/api/cases/case-badge-17/missions')
      .send({
        instruction: 'Work the highest-value open question and show what would close it.',
        scope: 'case',
      })
      .expect(200);

    expect(response.body.mission).toMatchObject({
      initiatedBy: 'investigator',
      status: 'completed',
      resultSessionId: response.body.session.id,
      runId: response.body.run.id,
    });
    expect(response.body.mission.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: 'recover-context',
          status: 'completed',
        }),
        expect.objectContaining({
          capability: 'investigate-anomaly',
          status: 'completed',
        }),
        expect.objectContaining({
          capability: 'challenge-account',
          status: 'completed',
        }),
        expect.objectContaining({ capability: 'persist-run', status: 'completed' }),
      ]),
    );
    expect(response.body.state.metadata.revision).toBe(2);

    const persisted = await request(app).get('/api/cases/case-badge-17').expect(200);
    expect(persisted.body.state.missions[0].id).toBe(response.body.mission.id);
    expect(persisted.body.state.researchSessions[0].id).toBe(response.body.session.id);
  });

  it('turns a monitoring mission into a standing order that checks new evidence', async () => {
    const app = createApp({
      store,
      environment: {},
      uploadDirectory: join(directory, 'uploads'),
    });
    const mission = await request(app)
      .post('/api/cases/case-badge-17/missions')
      .send({
        instruction: 'Monitor any new badge evidence and alert me when it arrives.',
        scope: 'case',
      })
      .expect(200);

    expect(mission.body.mission.status).toBe('completed');
    expect(mission.body.state.standingOrders[0]).toMatchObject({
      trigger: 'new-evidence',
      enabled: true,
      lastTriggeredAt: null,
    });

    const upload = await request(app)
      .post('/api/cases/case-badge-17/evidence')
      .field('title', 'Badge custody follow-up')
      .field('sourceLabel', 'Investigator notebook')
      .field('kind', 'document')
      .field('sourceReliability', 'C')
      .field('informationCredibility', '3')
      .attach('file', Buffer.from('New badge custody evidence was received.'), {
        filename: 'badge-follow-up.txt',
        contentType: 'text/plain',
      })
      .expect(201);

    expect(upload.body.state.standingOrders[0].lastTriggeredAt).not.toBeNull();
    expect(upload.body.state.missions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          initiatedBy: 'standing-order',
          status: 'completed',
          affectedIds: expect.arrayContaining([upload.body.receipt.evidenceId]),
        }),
        expect.objectContaining({
          initiatedBy: 'evidence-intake',
          status: 'completed',
        }),
      ]),
    );
  });

  it('does not pretend that a read-only mission sent an external message', async () => {
    const app = createApp({
      store,
      environment: {},
      uploadDirectory: join(directory, 'uploads'),
    });
    const response = await request(app)
      .post('/api/cases/case-badge-17/missions')
      .send({
        instruction:
          'Check the strongest account, then send the witness a summary of the result.',
        scope: 'case',
      })
      .expect(200);

    expect(response.body.mission.status).toBe('waiting-for-review');
    expect(response.body.mission.reviewReason).toContain('read-only');
    expect(response.body.mission.reviewReason).toContain('did not claim');
  });

  it('keeps connected browser results as located leads rather than evidence', async () => {
    const connectedResearch: ConnectedResearchAdapter = {
      status() {
        return Promise.resolve({
          id: 'aside',
          label: 'Aside connected research',
          configured: true,
          active: true,
          detail: 'Test adapter is ready.',
          state: 'ready',
          verifiedAt: new Date().toISOString(),
        });
      },
      research() {
        return Promise.resolve({
          answer:
            'A public event page supports the date, but the person-to-badge link remains a lead and is not established by the connected sweep.',
          answerStatus: 'lead-only',
          confidence: 0.58,
          findings: [
            {
              label: 'Event date corroborated',
              detail:
                'The public page matches the event date already represented in the case.',
              status: 'lead',
              confidence: 0.72,
              surfaceIndexes: [0],
            },
          ],
          surfaces: [
            {
              label: 'Public event page',
              surface: 'public-web',
              status: 'found',
              detail: 'Event date and venue were visible.',
              locator: 'https://example.test/event',
            },
            {
              label: 'Browser history',
              surface: 'browser-history',
              status: 'checked-empty',
              detail: 'No relevant visit was found.',
              locator: null,
            },
          ],
          negativeFindings: [
            {
              label: 'No direct identity link',
              detail: 'No connected source tied a named person to Badge C17.',
              surfaceIndexes: [0, 1],
            },
          ],
          corrections: [],
          nextQuestions: ['Can a preserved access export identify the badge custodian?'],
          limitations: ['The test sweep did not read a private message surface.'],
          model: 'test/connected-reader',
        });
      },
    };
    const app = createApp({
      store,
      environment: {},
      connectedResearch,
      uploadDirectory: join(directory, 'uploads'),
    });
    const before = await request(app).get('/api/cases/case-badge-17').expect(200);
    const response = await request(app)
      .post('/api/cases/case-badge-17/research')
      .send({
        question: 'Can connected sources corroborate the event context?',
        scope: 'connected',
      })
      .expect(200);

    expect(response.body.session).toMatchObject({
      scope: 'connected',
      provider: 'aside',
      answerStatus: 'lead-only',
    });
    expect(response.body.session.surfaceChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Public event page',
          locator: 'https://example.test/event',
          sourceId: null,
        }),
        expect.objectContaining({
          surface: 'browser-history',
          status: 'checked-empty',
        }),
      ]),
    );
    expect(response.body.state.evidence).toHaveLength(before.body.state.evidence.length);
    expect(response.body.state.worldEdges).toEqual(before.body.state.worldEdges);
  });

  it('preserves a real uploaded text file with its computed digest', async () => {
    const app = createApp({
      store,
      environment: {},
      uploadDirectory: join(directory, 'uploads'),
    });
    const response = await request(app)
      .post('/api/cases/case-badge-17/evidence')
      .field('title', 'Interview note')
      .field('sourceLabel', 'Witness notebook')
      .field('kind', 'document')
      .field('sourceReliability', 'C')
      .field('informationCredibility', '4')
      .attach('file', Buffer.from('Witness: maybe someone waited there.'), {
        filename: 'interview.txt',
        contentType: 'text/plain',
      })
      .expect(201);
    const artifact = response.body.state.evidence[0];
    expect(artifact.fileName).toBe('interview.txt');
    expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(artifact.extractionStatus).toBe('bounded-local');
    expect(response.body.state.worldEdges).toHaveLength(10);
    expect(response.body.receipt).toMatchObject({
      outcome: 'preserved',
      evidenceId: artifact.id,
      extractionStatus: 'bounded-local',
      clarificationId: null,
    });
    expect(response.body.state.missions[0]).toMatchObject({
      initiatedBy: 'evidence-intake',
      status: 'completed',
      runId: expect.any(String),
    });
    expect(await readFile(artifact.rawLocator, 'utf8')).toBe(
      'Witness: maybe someone waited there.',
    );
  });

  describe('an investigation with no fixture behind it', () => {
    async function newCase(app: ReturnType<typeof createApp>, title: string) {
      const created = await request(app).post('/api/cases').send({ title }).expect(201);
      return created.body.state.metadata.id as string;
    }

    async function upload(
      app: ReturnType<typeof createApp>,
      caseId: string,
      filename: string,
      content: string,
    ) {
      return request(app)
        .post(`/api/cases/${caseId}/evidence`)
        .field('title', filename)
        .field('sourceLabel', 'Uploaded by investigator')
        .field('kind', 'access-log')
        .field('sourceReliability', 'B')
        .field('informationCredibility', '2')
        .attach('file', Buffer.from(content), { filename, contentType: 'text/plain' })
        .expect(201);
    }

    it('starts a new case genuinely empty', async () => {
      const app = createApp({
        store,
        environment: {},
        uploadDirectory: join(directory, 'uploads'),
      });
      const caseId = await newCase(app, 'Warehouse shortfall');
      const response = await request(app).get(`/api/cases/${caseId}`).expect(200);

      expect(response.body.state.metadata.synthetic).toBe(false);
      expect(response.body.state.evidence).toEqual([]);
      expect(response.body.state.entities).toEqual([]);
      expect(response.body.state.worldEdges).toEqual([]);
      expect(response.body.state.reconstructions).toEqual([]);
    });

    it('refuses to delete a bundled demonstration case', async () => {
      const app = createApp({
        store,
        environment: {},
        uploadDirectory: join(directory, 'uploads'),
      });
      await request(app).delete('/api/cases/case-badge-17').expect(409);
      await request(app).get('/api/cases/case-badge-17').expect(200);
    });

    it('deletes a case the investigator created', async () => {
      const app = createApp({
        store,
        environment: {},
        uploadDirectory: join(directory, 'uploads'),
      });
      const caseId = await newCase(app, 'Disposable');
      await request(app).delete(`/api/cases/${caseId}`).expect(200);
      await request(app).get(`/api/cases/${caseId}`).expect(404);
    });

    it('builds entities, relationships and questions from uploaded text alone', async () => {
      const app = createApp({
        store,
        environment: {},
        uploadDirectory: join(directory, 'uploads'),
      });
      const caseId = await newCase(app, 'Warehouse shortfall');
      const response = await upload(
        app,
        caseId,
        'gate-log.txt',
        [
          'Camera 4: Dana Reyes entered Warehouse A on 2026-08-04T21:06:00Z.',
          'Camera 4: Vehicle 7VXK220 was parked at Warehouse A on 2026-08-04T21:04:00Z.',
        ].join('\n'),
      );

      const state = response.body.state;
      expect(state.entities.map((item: { label: string }) => item.label)).toEqual(
        expect.arrayContaining(['Dana Reyes', 'Warehouse A']),
      );
      expect(state.worldEdges.length).toBeGreaterThan(0);
      expect(state.anomalies.length).toBeGreaterThan(0);
      // Every derived relationship names its sources and the leap it required.
      for (const edge of state.worldEdges) {
        expect(edge.assumptionIds.length).toBeGreaterThan(0);
        expect(
          edge.sourceObservationIds.length + edge.sourceClaimIds.length,
        ).toBeGreaterThan(0);
      }
    });

    it('finds the contradiction between two artifacts that disagree', async () => {
      const app = createApp({
        store,
        environment: {},
        uploadDirectory: join(directory, 'uploads'),
      });
      const caseId = await newCase(app, 'Two cameras');
      await upload(
        app,
        caseId,
        'gate-log.txt',
        'Camera 4: Dana Reyes entered Warehouse A on 2026-08-04T21:06:00Z.',
      );
      const second = await upload(
        app,
        caseId,
        'pier-log.txt',
        'Camera 9: Dana Reyes was seen at Pier 48 on 2026-08-04T21:06:30Z.',
      );

      const state = second.body.state;
      const contradictions = state.beliefs.filter(
        (belief: { kind: string }) => belief.kind === 'contradiction',
      );
      expect(contradictions.length).toBeGreaterThan(0);
      // Competing explanations are offered; none is selected as the answer.
      const hypotheses = state.beliefs.filter(
        (belief: { kind: string }) => belief.kind === 'hypothesis',
      );
      expect(hypotheses.length).toBeGreaterThanOrEqual(3);
      expect(
        hypotheses.every((belief: { status: string }) => belief.status === 'open'),
      ).toBe(true);
      expect(state.reconstructions.length).toBeGreaterThanOrEqual(2);
      expect(
        state.reconstructions.filter((item: { isLeading: boolean }) => item.isLeading),
      ).toHaveLength(1);
    });

    it('re-derives without changing anything the second time', async () => {
      const app = createApp({
        store,
        environment: {},
        uploadDirectory: join(directory, 'uploads'),
      });
      const caseId = await newCase(app, 'Stable');
      await upload(
        app,
        caseId,
        'log.txt',
        'Camera 4: Dana Reyes entered Warehouse A on 2026-08-04T21:06:00Z.',
      );

      await request(app).post(`/api/cases/${caseId}/infer`).expect(200);
      const again = await request(app).post(`/api/cases/${caseId}/infer`).expect(200);
      expect(again.body.revision).toBeNull();
    });
  });

  it('preserves opaque evidence without inventing an interpretation', async () => {
    const app = createApp({
      store,
      environment: {},
      uploadDirectory: join(directory, 'uploads'),
    });
    const bytes = Buffer.from([0, 255, 17, 34, 51, 68]);
    const response = await request(app)
      .post('/api/cases/case-badge-17/evidence')
      .field('title', 'Unknown device export')
      .field('sourceLabel', 'Recovered media')
      .field('kind', 'other')
      .field('sourceReliability', 'F')
      .field('informationCredibility', '6')
      .attach('file', bytes, {
        filename: 'device-export.evd',
        contentType: 'application/octet-stream',
      })
      .expect(201);

    expect(response.body.receipt).toMatchObject({
      outcome: 'preserved',
      extractionStatus: 'requires-adapter',
      observationCount: 1,
      claimCount: 0,
      clarificationId: null,
    });
    expect(await readFile(response.body.state.evidence[0].rawLocator)).toEqual(bytes);
  });

  it('asks one persisted MCQ only for a hard file classification conflict', async () => {
    const app = createApp({
      store,
      environment: {},
      uploadDirectory: join(directory, 'uploads'),
    });
    const upload = await request(app)
      .post('/api/cases/case-badge-17/evidence')
      .field('title', 'Door frame mislabeled as audio')
      .field('sourceLabel', 'Camera export')
      .field('kind', 'audio')
      .field('sourceReliability', 'F')
      .field('informationCredibility', '6')
      .attach('file', Buffer.from('not-real-image-bytes'), {
        filename: 'door-frame.png',
        contentType: 'image/png',
      })
      .expect(201);
    const clarification = upload.body.state.clarifications[0];
    expect(upload.body.receipt.clarificationId).toBe(clarification.id);
    expect(clarification).toMatchObject({
      evidenceId: upload.body.receipt.evidenceId,
      submittedKind: 'audio',
      detectedKind: 'image',
      status: 'open',
      allowCustomAnswer: true,
    });
    expect(clarification.choices).toHaveLength(3);
    expect(clarification.choices[0]).toMatchObject({
      id: 'use-detected',
      recommended: true,
    });

    const answer = await request(app)
      .post(`/api/cases/case-badge-17/evidence/clarifications/${clarification.id}`)
      .send({ choiceId: 'leave-unresolved' })
      .expect(200);
    expect(answer.body.clarification).toMatchObject({
      status: 'answered',
      selectedChoiceId: 'leave-unresolved',
    });
    const persisted = await request(app).get('/api/cases/case-badge-17').expect(200);
    expect(persisted.body.state.clarifications[0].status).toBe('answered');
  });

  it('serves only preserved user image content for the evidence board preview', async () => {
    const app = createApp({
      store,
      environment: {},
      uploadDirectory: join(directory, 'uploads'),
    });
    const bytes = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489',
      'hex',
    );
    const upload = await request(app)
      .post('/api/cases/case-badge-17/evidence')
      .field('title', 'User scene photograph')
      .field('sourceLabel', 'Detective upload')
      .field('kind', 'image')
      .field('sourceReliability', 'F')
      .field('informationCredibility', '6')
      .attach('file', bytes, { filename: 'scene.png', contentType: 'image/png' })
      .expect(201);
    const artifact = upload.body.state.evidence[0] as { id: string };

    const preview = await request(app)
      .get(`/api/cases/case-badge-17/evidence/${artifact.id}/content`)
      .expect(200);
    expect(preview.headers['content-type']).toMatch(/^image\/png/u);
    expect(Buffer.compare(preview.body as Buffer, bytes)).toBe(0);

    await request(app).get('/api/cases/case-badge-17/evidence/EV-058/content').expect(404);
  });

  it('applies Evidence 143 once and can reset the case', async () => {
    const app = createApp({
      store,
      environment: {},
      uploadDirectory: join(directory, 'uploads'),
    });
    const first = await request(app)
      .post('/api/cases/case-badge-17/evidence/demo-143')
      .expect(200);
    expect(first.body.revision.triggerEvidenceId).toBe('EV-143');
    expect(
      first.body.state.reconstructions.find((item: { id: string }) => item.id === 'R-C')
        .isLeading,
    ).toBe(true);
    const second = await request(app)
      .post('/api/cases/case-badge-17/evidence/demo-143')
      .expect(200);
    expect(second.body.revision).toBeNull();

    const reset = await request(app).post('/api/demo/reset').expect(200);
    expect(reset.body.state.metadata.revision).toBe(1);
    expect(
      reset.body.state.evidence.some((item: { id: string }) => item.id === 'EV-143'),
    ).toBe(false);
  });
});
