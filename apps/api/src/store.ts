import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  createSampleCase,
  createHackathonCase,
  hackathonCaseId,
  sampleCaseId,
  type CasePacket,
  type CaseMetadata,
  type CaseState,
  type InvestigationStrategy,
  type RuntimeCapability,
  validateCaseIntegrity,
} from '@thread/domain';
import { MongoClient, type Collection, type Document } from 'mongodb';
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  embedTexts,
  embeddingRuntimeStatus,
} from './embeddings.js';

export interface StoreDiagnostics {
  capabilities: RuntimeCapability[];
}

export interface CaseStore {
  readonly mode: 'local-json' | 'mongodb';
  initialize(): Promise<void>;
  getCase(caseId: string): Promise<CaseState | null>;
  listCases(): Promise<CaseMetadata[]>;
  buildCasePacket(
    state: CaseState,
    question: string,
    strategy?: Partial<InvestigationStrategy>,
  ): Promise<CasePacket>;
  diagnostics(): Promise<StoreDiagnostics>;
  saveCase(state: CaseState): Promise<void>;
  resetDemo(caseId?: string): Promise<CaseState>;
  close(): Promise<void>;
}

function isCaseState(value: unknown): value is CaseState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CaseState>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.metadata?.id === 'string' &&
    Array.isArray(candidate.evidence) &&
    Array.isArray(candidate.worldEdges) &&
    Array.isArray(candidate.beliefs)
  );
}

function normalizeCaseState(state: CaseState): CaseState {
  const candidate = state as CaseState & Record<string, unknown>;
  candidate.worldMemory ??= [];
  candidate.evidenceMemory ??= [];
  candidate.beliefMemory ??= [];
  candidate.casePackets ??= [];
  candidate.researchSessions ??= [];
  candidate.agentRuns ??= [];
  candidate.missions ??= [];
  candidate.standingOrders ??= [];
  candidate.clarifications ??= [];
  candidate.temporalConstraints ??= [];
  for (const packet of candidate.casePackets) {
    packet.retrievalHits ??= packet.observationIds.map((observationId, index) => {
      const observation = candidate.observations.find((item) => item.id === observationId);
      return {
        observationId,
        evidenceId: observation?.sourceEvidenceId ?? '',
        rank: index + 1,
        score: null,
        matchedBy: packet.exactMatchIds.includes(observationId)
          ? (['lexical'] as const)
          : packet.semanticMatchIds.includes(observationId)
            ? (['semantic'] as const)
            : (['material-fallback'] as const),
      };
    });
  }
  return candidate;
}

const defaultStrategy: InvestigationStrategy = {
  entityExpansion: true,
  temporalFilter: true,
  keywordSearch: true,
  semanticSearch: true,
  graphDepth: 2,
};

function termsFor(question: string): string[] {
  return [
    ...new Set(
      question
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
        .split(/\s+/u)
        .filter((term) => term.length > 1),
    ),
  ];
}

function boundedPacket(
  state: CaseState,
  question: string,
  strategy: InvestigationStrategy,
  method: CasePacket['retrievalMethod'] = 'local-bounded-fallback',
): CasePacket {
  const terms = termsFor(question);
  const ranked = state.observations
    .map((observation) => ({
      observation,
      score: terms.reduce(
        (score, term) =>
          score +
          (observation.text.toLocaleLowerCase().includes(term) ? 2 : 0) +
          (observation.entityIds.some((id) => id.toLocaleLowerCase().includes(term))
            ? 1
            : 0),
        0,
      ),
    }))
    .sort(
      (a, b) =>
        b.score - a.score || b.observation.materialWeight - a.observation.materialWeight,
    )
    .slice(0, 8);
  const observationIds = ranked.map(({ observation }) => observation.id);
  const evidenceIds = [
    ...new Set(ranked.map(({ observation }) => observation.sourceEvidenceId)),
  ];
  const entityIds = [
    ...new Set(ranked.flatMap(({ observation }) => observation.entityIds)),
  ];
  const neighborIds = new Set<string>();
  for (const edge of state.worldEdges) {
    if (entityIds.includes(edge.subjectId) || entityIds.includes(edge.objectId)) {
      neighborIds.add(edge.subjectId);
      neighborIds.add(edge.objectId);
    }
  }
  const previousAttemptIds = state.proceduralMemory
    .map((attempt) => {
      const attemptTerms = new Set(termsFor(`${attempt.question} ${attempt.result}`));
      const termOverlap = terms.filter((term) => attemptTerms.has(term)).length;
      const evidenceOverlap = attempt.returnedEvidenceIds.filter((id) =>
        evidenceIds.includes(id),
      ).length;
      return {
        id: attempt.id,
        relevance: termOverlap * 2 + evidenceOverlap,
        utility: attempt.utilityScore,
      };
    })
    .filter((attempt) => attempt.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || b.utility - a.utility)
    .slice(0, 3)
    .map((attempt) => attempt.id);
  return {
    id: `PACKET-${state.metadata.revision + 1}-${Date.now().toString(36).toUpperCase()}`,
    caseId: state.metadata.id,
    question,
    retrievalMethod: method,
    exactMatchIds: ranked
      .filter((item) => item.score > 0)
      .map((item) => item.observation.id),
    semanticMatchIds: [],
    graphNeighborIds: [...neighborIds],
    previousAttemptIds,
    evidenceIds,
    observationIds,
    retrievalHits: ranked.map(({ observation, score }, index) => ({
      observationId: observation.id,
      evidenceId: observation.sourceEvidenceId,
      rank: index + 1,
      score,
      matchedBy: score > 0 ? ['lexical'] : ['material-fallback'],
    })),
    strategy,
    createdAt: new Date().toISOString(),
  };
}

export class JsonCaseStore implements CaseStore {
  readonly mode = 'local-json' as const;
  readonly dataDirectory: string;
  private readonly legacyStatePath: string;
  private readonly casesDirectory: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDirectory: string) {
    this.dataDirectory = resolve(dataDirectory);
    this.legacyStatePath = join(this.dataDirectory, 'thread.json');
    this.casesDirectory = join(this.dataDirectory, 'cases');
  }

  private casePath(caseId: string): string {
    const safeId = caseId.replace(/[^a-zA-Z0-9_-]+/gu, '-');
    return join(this.casesDirectory, `${safeId}.json`);
  }

  async initialize(): Promise<void> {
    await mkdir(this.casesDirectory, { recursive: true });
    const sample = await this.getCase(sampleCaseId);
    // Saving an existing legacy thread.json snapshot migrates it into the
    // multi-case directory without deleting the original.
    await this.saveCase(sample ?? createSampleCase());
    const hackathon = await this.getCase(hackathonCaseId);
    if (!hackathon) await this.saveCase(createHackathonCase());
  }

  async getCase(caseId: string): Promise<CaseState | null> {
    const paths = [
      this.casePath(caseId),
      ...(caseId === sampleCaseId ? [this.legacyStatePath] : []),
    ];
    for (const path of paths) {
      try {
        const source = await readFile(path, 'utf8');
        const parsed: unknown = JSON.parse(source);
        if (!isCaseState(parsed))
          throw new Error('Local case store contains an unsupported schema.');
        if (parsed.metadata.id === caseId) return normalizeCaseState(parsed);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return null;
  }

  async listCases(): Promise<CaseMetadata[]> {
    const entries = await readdir(this.casesDirectory, { withFileTypes: true }).catch(
      () => [],
    );
    const metadata: CaseMetadata[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const parsed: unknown = JSON.parse(
        await readFile(join(this.casesDirectory, entry.name), 'utf8'),
      );
      if (isCaseState(parsed)) metadata.push(normalizeCaseState(parsed).metadata);
    }
    return metadata.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async buildCasePacket(
    state: CaseState,
    question: string,
    overrides: Partial<InvestigationStrategy> = {},
  ): Promise<CasePacket> {
    await Promise.resolve();
    return boundedPacket(state, question, { ...defaultStrategy, ...overrides });
  }

  async diagnostics(): Promise<StoreDiagnostics> {
    await Promise.resolve();
    return {
      capabilities: [
        {
          id: 'local-embeddings',
          label: 'Local semantic embeddings',
          active: false,
          detail: 'JSON fallback uses bounded lexical retrieval only.',
        },
        ...(
          [
            'atlas-search',
            'atlas-vector-search',
            'rank-fusion',
            'graph-lookup',
            'change-streams',
            'langgraph-checkpoints',
          ] as const
        ).map((id) => ({
          id,
          label: id.replaceAll('-', ' '),
          active: false,
          detail: 'Requires Atlas Local.',
        })),
      ],
    };
  }

  async saveCase(state: CaseState): Promise<void> {
    const integrity = validateCaseIntegrity(normalizeCaseState(state));
    if (!integrity.ok) {
      throw new Error(
        `Refused to persist ${state.metadata.id}: ${integrity.issues
          .filter((item) => item.severity === 'error')
          .map((item) => `${item.code}${item.objectId ? `/${item.objectId}` : ''}`)
          .join(', ')}.`,
      );
    }
    const serialized = `${JSON.stringify(state, null, 2)}\n`;
    this.writeQueue = this.writeQueue.then(async () => {
      const statePath = this.casePath(state.metadata.id);
      await mkdir(dirname(statePath), { recursive: true });
      const temporaryPath = `${statePath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, serialized, 'utf8');
      await rename(temporaryPath, statePath);
    });
    await this.writeQueue;
  }

  async resetDemo(caseId = sampleCaseId): Promise<CaseState> {
    const state =
      caseId === hackathonCaseId
        ? createHackathonCase()
        : caseId === sampleCaseId
          ? createSampleCase()
          : null;
    if (!state) throw new Error(`Unknown bundled case: ${caseId}`);
    await this.saveCase(state);
    return state;
  }

  async close(): Promise<void> {
    await this.writeQueue;
  }
}

type StateArrayKey = Exclude<keyof CaseState, 'schemaVersion' | 'metadata'>;

const collectionMap: Record<StateArrayKey, string> = {
  evidence: 'evidence',
  observations: 'observations',
  claims: 'claims',
  entities: 'entities',
  worldEdges: 'edges',
  unresolvedReferences: 'unresolved_references',
  assumptions: 'assumptions',
  beliefs: 'beliefs',
  beliefEdges: 'belief_edges',
  reconstructions: 'reconstructions',
  anomalies: 'anomalies',
  worldMemory: 'memory_world',
  evidenceMemory: 'memory_evidence',
  beliefMemory: 'memory_belief',
  proceduralMemory: 'memory_procedural',
  casePackets: 'case_packets',
  researchSessions: 'research_sessions',
  agentRuns: 'agent_runs',
  missions: 'agent_missions',
  standingOrders: 'standing_orders',
  clarifications: 'evidence_clarifications',
  temporalConstraints: 'temporal_constraints',
  revisions: 'case_revisions',
};

interface MongoCaseMeta extends Document {
  _id: string;
  schemaVersion: 1;
  metadata: CaseMetadata;
  snapshotRevision: number;
}

export class MongoCaseStore implements CaseStore {
  readonly mode = 'mongodb' as const;
  private readonly client: MongoClient;
  private readonly databaseName: string;
  private readonly embeddingCacheDirectory: string;
  private searchReady = false;
  private rankFusionReady = false;
  private graphLookupReady = false;
  private changeStreamsReady = false;

  constructor(uri: string, databaseName: string, embeddingCacheDirectory: string) {
    this.client = new MongoClient(uri, { appName: 'THREAD' });
    this.databaseName = databaseName;
    this.embeddingCacheDirectory = embeddingCacheDirectory;
  }

  private get database() {
    return this.client.db(this.databaseName);
  }

  private collection(name: string): Collection<Document> {
    return this.database.collection(name);
  }

  async initialize(): Promise<void> {
    await this.client.connect();
    await this.database.command({ ping: 1 });
    for (const name of Object.values(collectionMap)) {
      await this.collection(name).createIndex({ caseId: 1, snapshotRevision: 1 });
    }
    await this.collection('observations').createIndex({ id: 1, caseId: 1 });
    await this.collection('edges').createIndex({ subjectId: 1, objectId: 1, caseId: 1 });
    await this.collection('case_packets').createIndex({ caseId: 1, createdAt: -1 });
    const existing = await this.getCase(sampleCaseId);
    if (!existing) await this.saveCase(createSampleCase());
    const hackathon = await this.getCase(hackathonCaseId);
    if (!hackathon) await this.saveCase(createHackathonCase());
    // Warm the local model explicitly so health reflects an exercised runtime,
    // not merely a model file that happens to exist on disk.
    await embedTexts(
      ['THREAD local embedding readiness probe'],
      this.embeddingCacheDirectory,
    );
    await this.ensureSearchIndexes();
    await this.probeCapabilities();
  }

  private async ensureSearchIndexes(): Promise<void> {
    const observations = this.collection('observations');
    const existing = await observations
      .listSearchIndexes()
      .toArray()
      .catch(() => []);
    const names = new Set(existing.map((index) => String(index.name)));
    if (!names.has('obs_text')) {
      await observations.createSearchIndex({
        name: 'obs_text',
        type: 'search',
        definition: {
          mappings: {
            dynamic: false,
            fields: {
              text: { type: 'string' },
              caseId: { type: 'token' },
              snapshotRevision: { type: 'number' },
              entityIds: { type: 'token' },
            },
          },
        },
      });
    }
    if (!names.has('obs_vec')) {
      await observations.createSearchIndex({
        name: 'obs_vec',
        type: 'vectorSearch',
        definition: {
          fields: [
            {
              type: 'vector',
              path: 'embedding',
              numDimensions: EMBEDDING_DIMENSIONS,
              similarity: 'cosine',
            },
            { type: 'filter', path: 'caseId' },
            { type: 'filter', path: 'snapshotRevision' },
          ],
        },
      });
    }
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const indexes = await observations
        .listSearchIndexes()
        .toArray()
        .catch(() => []);
      const ready = new Set(
        indexes
          .filter((index) => {
            const status = index as Document;
            return status.queryable === true || status.status === 'READY';
          })
          .map((index) => String(index.name)),
      );
      if (ready.has('obs_text') && ready.has('obs_vec')) {
        this.searchReady = true;
        return;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
    }
    this.searchReady = false;
  }

  private async probeCapabilities(): Promise<void> {
    const meta = await this.database.collection<MongoCaseMeta>('case_meta').findOne({});
    if (!meta) return;
    try {
      await this.collection('observations')
        .aggregate([
          {
            $rankFusion: {
              input: {
                pipelines: {
                  material: [
                    {
                      $match: {
                        caseId: meta._id,
                        snapshotRevision: meta.snapshotRevision,
                      },
                    },
                    { $sort: { materialWeight: -1 } },
                    { $limit: 2 },
                  ],
                  confidence: [
                    {
                      $match: {
                        caseId: meta._id,
                        snapshotRevision: meta.snapshotRevision,
                      },
                    },
                    { $sort: { extractionConfidence: -1 } },
                    { $limit: 2 },
                  ],
                },
              },
              combination: {
                weights: { material: 1, confidence: 0.5 },
              },
            },
          },
          { $limit: 1 },
        ])
        .toArray();
      this.rankFusionReady = true;
    } catch {
      this.rankFusionReady = false;
    }
    try {
      await this.collection('entities')
        .aggregate([
          { $match: { caseId: meta._id, snapshotRevision: meta.snapshotRevision } },
          { $limit: 1 },
          {
            $graphLookup: {
              from: 'edges',
              startWith: '$id',
              connectFromField: 'objectId',
              connectToField: 'subjectId',
              as: 'probe',
              maxDepth: 1,
              restrictSearchWithMatch: {
                caseId: meta._id,
                snapshotRevision: meta.snapshotRevision,
              },
            },
          },
        ])
        .toArray();
      this.graphLookupReady = true;
    } catch {
      this.graphLookupReady = false;
    }
    try {
      const stream = this.collection('case_meta').watch([], { maxAwaitTimeMS: 50 });
      await stream.close();
      this.changeStreamsReady = true;
    } catch {
      this.changeStreamsReady = false;
    }
  }

  async getCase(caseId: string): Promise<CaseState | null> {
    const meta = await this.database
      .collection<MongoCaseMeta>('case_meta')
      .findOne({ _id: caseId });
    if (!meta) return null;
    const entries = await Promise.all(
      (Object.entries(collectionMap) as Array<[StateArrayKey, string]>).map(
        async ([key, collectionName]) => {
          const documents = await this.collection(collectionName)
            .find({ caseId, snapshotRevision: meta.snapshotRevision })
            .toArray();
          const cleaned = documents.map((document) => {
            const { _id, snapshotRevision, embedding, embeddingModel, ...item } = document;
            void _id;
            void snapshotRevision;
            void embedding;
            void embeddingModel;
            return item;
          });
          return [key, cleaned] as const;
        },
      ),
    );
    const candidate: unknown = {
      schemaVersion: meta.schemaVersion,
      metadata: meta.metadata,
      ...Object.fromEntries(entries),
    };
    if (!isCaseState(candidate))
      throw new Error('MongoDB returned an unsupported case schema.');
    return normalizeCaseState(candidate);
  }

  async listCases(): Promise<CaseMetadata[]> {
    const records = await this.database
      .collection<MongoCaseMeta>('case_meta')
      .find({})
      .sort({ 'metadata.updatedAt': -1 })
      .toArray();
    return records.map((record) => record.metadata);
  }

  async buildCasePacket(
    state: CaseState,
    question: string,
    overrides: Partial<InvestigationStrategy> = {},
  ): Promise<CasePacket> {
    const strategy = { ...defaultStrategy, ...overrides };
    if (!this.searchReady || !this.rankFusionReady) {
      return boundedPacket(state, question, strategy);
    }
    try {
      const [queryVector] = await embedTexts([question], this.embeddingCacheDirectory);
      if (!queryVector) return boundedPacket(state, question, strategy);
      const pipeline: Document[] = [
        {
          $rankFusion: {
            input: {
              pipelines: {
                semantic: [
                  {
                    $vectorSearch: {
                      index: 'obs_vec',
                      path: 'embedding',
                      queryVector,
                      numCandidates: 80,
                      limit: 20,
                      filter: {
                        caseId: state.metadata.id,
                        snapshotRevision: state.metadata.revision,
                      },
                    },
                  },
                ],
                lexical: [
                  {
                    $search: {
                      index: 'obs_text',
                      compound: {
                        filter: [
                          {
                            equals: { path: 'caseId', value: state.metadata.id },
                          },
                          {
                            equals: {
                              path: 'snapshotRevision',
                              value: state.metadata.revision,
                            },
                          },
                        ],
                        should: [
                          {
                            text: {
                              query: question,
                              path: 'text',
                              fuzzy: { maxEdits: 1, prefixLength: 2 },
                            },
                          },
                        ],
                        minimumShouldMatch: 1,
                      },
                    },
                  },
                  { $limit: 20 },
                ],
              },
            },
            combination: { weights: { semantic: 1, lexical: 0.75 } },
            scoreDetails: true,
          },
        },
        {
          $project: {
            id: 1,
            sourceEvidenceId: 1,
            entityIds: 1,
            text: 1,
            materialWeight: 1,
            extractionConfidence: 1,
            retrievalScoreDetails: { $meta: 'scoreDetails' },
          },
        },
        { $limit: 8 },
      ];
      let documents: Document[] = [];
      // Atlas Search indexes update asynchronously after an evidence snapshot.
      // Bound the wait instead of silently downgrading an immediate post-ingest run.
      for (let attempt = 0; attempt < 12 && documents.length === 0; attempt += 1) {
        documents = await this.collection('observations').aggregate(pipeline).toArray();
        if (documents.length === 0) {
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 350));
        }
      }
      if (documents.length === 0) return boundedPacket(state, question, strategy);
      const observationIds = documents.map((document) => String(document.id));
      const evidenceIds = [
        ...new Set(documents.map((document) => String(document.sourceEvidenceId))),
      ];
      const entityIds = [
        ...new Set(documents.flatMap((document) => (document.entityIds as string[]) ?? [])),
      ];
      const graphResults =
        entityIds.length === 0
          ? []
          : await this.collection('entities')
              .aggregate([
                {
                  $match: {
                    caseId: state.metadata.id,
                    snapshotRevision: state.metadata.revision,
                    id: { $in: entityIds },
                  },
                },
                {
                  $graphLookup: {
                    from: 'edges',
                    startWith: '$id',
                    connectFromField: 'objectId',
                    connectToField: 'subjectId',
                    as: 'linkedEdges',
                    maxDepth: Math.max(0, strategy.graphDepth - 1),
                    restrictSearchWithMatch: {
                      caseId: state.metadata.id,
                      snapshotRevision: state.metadata.revision,
                    },
                  },
                },
              ])
              .toArray();
      const graphNeighborIds = [
        ...new Set(
          graphResults.flatMap((result) =>
            ((result.linkedEdges as Document[]) ?? []).flatMap((edge) => [
              String(edge.subjectId),
              String(edge.objectId),
            ]),
          ),
        ),
      ];
      const retrievalHits = documents.map((document, index) => {
        const scoreDetails = document.retrievalScoreDetails as
          | {
              value?: unknown;
              details?: Array<{ inputPipelineName?: unknown; rank?: unknown }>;
            }
          | undefined;
        const matchedBy = [
          ...(scoreDetails?.details?.some(
            (detail) => detail.inputPipelineName === 'lexical' && detail.rank !== 'N/A',
          )
            ? (['lexical'] as const)
            : []),
          ...(scoreDetails?.details?.some(
            (detail) => detail.inputPipelineName === 'semantic' && detail.rank !== 'N/A',
          )
            ? (['semantic'] as const)
            : []),
        ];
        return {
          observationId: String(document.id),
          evidenceId: String(document.sourceEvidenceId),
          rank: index + 1,
          score: typeof scoreDetails?.value === 'number' ? scoreDetails.value : null,
          matchedBy:
            matchedBy.length > 0
              ? matchedBy
              : (['material-fallback'] as Array<
                  'lexical' | 'semantic' | 'material-fallback'
                >),
        };
      });
      return {
        id: `PACKET-${state.metadata.revision + 1}-${Date.now().toString(36).toUpperCase()}`,
        caseId: state.metadata.id,
        question,
        retrievalMethod: 'atlas-rank-fusion',
        exactMatchIds: retrievalHits
          .filter((hit) => hit.matchedBy.includes('lexical'))
          .map((hit) => hit.observationId),
        semanticMatchIds: retrievalHits
          .filter((hit) => hit.matchedBy.includes('semantic'))
          .map((hit) => hit.observationId),
        graphNeighborIds,
        previousAttemptIds: state.proceduralMemory
          .map((attempt) => ({
            attempt,
            overlap: termsFor(question).filter((term) =>
              termsFor(`${attempt.question} ${attempt.result}`).includes(term),
            ).length,
          }))
          .filter((item) => item.overlap > 0)
          .sort(
            (a, b) =>
              b.overlap - a.overlap || b.attempt.utilityScore - a.attempt.utilityScore,
          )
          .slice(0, 3)
          .map((item) => item.attempt.id),
        evidenceIds,
        observationIds,
        retrievalHits,
        strategy,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      process.stderr.write(
        `THREAD case-packet fallback: ${error instanceof Error ? error.message : 'Atlas hybrid retrieval failed'}\n`,
      );
      return boundedPacket(state, question, strategy);
    }
  }

  async diagnostics(): Promise<StoreDiagnostics> {
    await Promise.resolve();
    const embedding = embeddingRuntimeStatus();
    return {
      capabilities: [
        {
          id: 'atlas-search',
          label: 'Atlas Search',
          active: this.searchReady,
          detail: this.searchReady
            ? 'obs_text is queryable.'
            : 'Search index is not ready.',
        },
        {
          id: 'atlas-vector-search',
          label: 'Atlas Vector Search',
          active: this.searchReady,
          detail: this.searchReady
            ? 'obs_vec is queryable at 384 dimensions.'
            : 'Vector index is not ready.',
        },
        {
          id: 'rank-fusion',
          label: '$rankFusion',
          active: this.rankFusionReady,
          detail: this.rankFusionReady
            ? 'Server-side reciprocal rank fusion probe passed.'
            : 'The server-side probe failed; bounded fallback is used.',
        },
        {
          id: 'graph-lookup',
          label: '$graphLookup',
          active: this.graphLookupReady,
          detail: this.graphLookupReady
            ? 'Two-hop edge expansion probe passed.'
            : 'Graph expansion probe failed.',
        },
        {
          id: 'change-streams',
          label: 'Change streams',
          active: this.changeStreamsReady,
          detail: this.changeStreamsReady
            ? 'Replica-set change stream opened successfully.'
            : 'Change stream probe failed.',
        },
        {
          id: 'langgraph-checkpoints',
          label: 'LangGraph checkpoints',
          active: true,
          detail: 'MongoDB checkpointer is configured against the local replica set.',
        },
        {
          id: 'local-embeddings',
          label: 'Local semantic embeddings',
          active: embedding.loaded,
          detail: `${EMBEDDING_MODEL} · ${EMBEDDING_DIMENSIONS} dimensions · on-device cache.`,
        },
      ],
    };
  }

  async saveCase(state: CaseState): Promise<void> {
    const integrity = validateCaseIntegrity(normalizeCaseState(state));
    if (!integrity.ok) {
      throw new Error(
        `Refused to persist ${state.metadata.id}: ${integrity.issues
          .filter((item) => item.severity === 'error')
          .map((item) => `${item.code}${item.objectId ? `/${item.objectId}` : ''}`)
          .join(', ')}.`,
      );
    }
    const snapshotRevision = state.metadata.revision;
    const observationEmbeddings = await embedTexts(
      state.observations.map((observation) => observation.text),
      this.embeddingCacheDirectory,
    );
    for (const [key, collectionName] of Object.entries(collectionMap) as Array<
      [StateArrayKey, string]
    >) {
      const values = state[key];
      await this.collection(collectionName).deleteMany({
        caseId: state.metadata.id,
        snapshotRevision,
      });
      if (values.length > 0) {
        await this.collection(collectionName).insertMany(
          values.map((value, index) => {
            const document: Document = {
              ...(value as unknown as Document),
              caseId: state.metadata.id,
              snapshotRevision,
            };
            if (key === 'observations') {
              document.embedding = observationEmbeddings[index];
              document.embeddingModel = EMBEDDING_MODEL;
            }
            return document;
          }),
        );
      }
    }
    await this.database.collection<MongoCaseMeta>('case_meta').replaceOne(
      { _id: state.metadata.id },
      {
        _id: state.metadata.id,
        schemaVersion: state.schemaVersion,
        metadata: state.metadata,
        snapshotRevision,
      },
      { upsert: true },
    );
    for (const collectionName of Object.values(collectionMap)) {
      await this.collection(collectionName).deleteMany({
        caseId: state.metadata.id,
        snapshotRevision: { $ne: snapshotRevision },
      });
    }
  }

  async resetDemo(caseId = sampleCaseId): Promise<CaseState> {
    const state =
      caseId === hackathonCaseId
        ? createHackathonCase()
        : caseId === sampleCaseId
          ? createSampleCase()
          : null;
    if (!state) throw new Error(`Unknown bundled case: ${caseId}`);
    await this.saveCase(state);
    return state;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export function createStore(
  environment: NodeJS.ProcessEnv = process.env,
  defaultDataDirectory = '.thread-data',
): CaseStore {
  const mongoUri = environment.MONGODB_URI?.trim();
  if (mongoUri) {
    const embeddingCacheDirectory =
      environment.THREAD_MODEL_CACHE?.trim() ||
      resolve(defaultDataDirectory, '..', '.thread-cache', 'huggingface');
    return new MongoCaseStore(
      mongoUri,
      environment.MONGODB_DATABASE?.trim() || 'thread',
      embeddingCacheDirectory,
    );
  }
  return new JsonCaseStore(environment.THREAD_DATA_DIR?.trim() || defaultDataDirectory);
}
