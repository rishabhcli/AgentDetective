export type ISODateTime = string;

export type EvidenceKind =
  | 'message'
  | 'email'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'access-log'
  | 'calendar'
  | 'location'
  | 'other';

export type ExtractionStatus = 'complete' | 'bounded-local' | 'requires-adapter';

export interface TimeInterval {
  earliest: ISODateTime;
  latest: ISODateTime;
  precision: 'exact' | 'minute' | 'range' | 'day' | 'unknown';
  confidence: number;
}

export interface EvidenceArtifact {
  id: string;
  caseId: string;
  title: string;
  kind: EvidenceKind;
  fileName: string;
  mimeType: string;
  sha256: string;
  ingestedAt: ISODateTime;
  capturedAt: TimeInterval | null;
  sourceLabel: string;
  chainOfCustody: string;
  content: string | null;
  rawLocator: string | null;
  extractionStatus: ExtractionStatus;
  extractor:
    | 'authored-fixture'
    | 'redacted-case-derivative'
    | 'local-deterministic'
    | 'fireworks'
    | 'elevenlabs';
  observationIds: string[];
  claimIds: string[];
  synthetic: boolean;
  challengedByEvidenceIds: string[];
}

export type ObservationKind =
  | 'text'
  | 'visual'
  | 'temporal'
  | 'access'
  | 'location'
  | 'identity-signal'
  | 'unprocessed-media';

export interface Observation {
  id: string;
  caseId: string;
  sourceEvidenceId: string;
  kind: ObservationKind;
  text: string;
  locator: string;
  extractionConfidence: number;
  interval: TimeInterval | null;
  entityIds: string[];
  materialWeight: number;
}

export type SourceReliability = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type InformationCredibility = 1 | 2 | 3 | 4 | 5 | 6;

export interface Claim {
  id: string;
  caseId: string;
  sourceEvidenceId: string;
  speaker: string | null;
  proposition: string;
  verbatim: string;
  extractionConfidence: number;
  sourceReliability: SourceReliability;
  informationCredibility: InformationCredibility;
  hedges: string[];
  interval: TimeInterval | null;
  unresolvedReferenceIds: string[];
}

export type EntityKind =
  | 'person'
  | 'organization'
  | 'identity'
  | 'account'
  | 'device'
  | 'vehicle'
  | 'location'
  | 'object'
  | 'event'
  | 'time-interval';

export interface Entity {
  id: string;
  caseId: string;
  kind: EntityKind;
  label: string;
  shortLabel: string;
  description: string;
  aliases: string[];
  properties: Record<string, string[]>;
  confidence: number;
  sourceEvidenceIds: string[];
  interval: TimeInterval | null;
}

export type WorldPredicate =
  | 'AUTHORED'
  | 'MENTIONS'
  | 'USES'
  | 'MAY_BE_SAME_AS'
  | 'COMMUNICATED_WITH'
  | 'OBSERVED_AT'
  | 'TRAVELED_TO'
  | 'MET_WITH'
  | 'OWNS'
  | 'HAS_ACCESS_TO'
  | 'PARTICIPATED_IN'
  | 'BEFORE'
  | 'AFTER'
  | 'OVERLAPS'
  | 'INVOLVES';

export type LensId = 'people' | 'time' | 'place' | 'objects' | 'evidence' | 'theory';

export interface EdgeContribution {
  sourceId: string;
  label: string;
  weight: number;
  polarity: 'support' | 'oppose';
}

export interface WorldEdge {
  id: string;
  caseId: string;
  subjectId: string;
  predicate: WorldPredicate;
  objectId: string;
  confidence: number;
  sourceClaimIds: string[];
  sourceObservationIds: string[];
  contributions: EdgeContribution[];
  validTime: TimeInterval | null;
  transactionTime: ISODateTime;
  disputed: boolean;
  alternatives: string[];
  createdByAgent: 'fixture' | 'resolver' | 'chronologist' | 'linker';
  assumptionIds: string[];
  lenses: LensId[];
}

export interface CandidateBinding {
  entityId: string | null;
  label: string;
  probability: number;
  prior: number;
  signalIds: string[];
}

export interface ResolutionSignal {
  id: string;
  candidateEntityId: string | null;
  evidenceId: string;
  channel: 'lexical' | 'contact' | 'social' | 'temporal' | 'geographic' | 'object';
  label: string;
  weight: number;
}

export interface UnresolvedReference {
  id: string;
  caseId: string;
  surfaceForm: string;
  context: string;
  kindProbabilities: Record<string, number>;
  candidateBindings: CandidateBinding[];
  resolutionSignals: ResolutionSignal[];
  status: 'open' | 'candidate' | 'resolved';
  resolvedBy: string | null;
  sourceEvidenceIds: string[];
}

export type AssumptionStatus = 'valid' | 'contested' | 'invalid';

export interface Assumption {
  id: string;
  caseId: string;
  label: string;
  detail: string;
  status: AssumptionStatus;
  sourceEvidenceIds: string[];
  invalidatedByEvidenceId: string | null;
}

export type BeliefKind =
  | 'hypothesis'
  | 'inference'
  | 'contradiction'
  | 'unresolved-question'
  | 'alternative-explanation'
  | 'reconstruction';

export type BeliefStatus = 'supported' | 'contested' | 'weakened' | 'rejected' | 'open';

export interface Belief {
  id: string;
  caseId: string;
  kind: BeliefKind;
  label: string;
  detail: string;
  status: BeliefStatus;
  confidence: number;
  sourceIds: string[];
  environments: string[][];
  survivingEnvironments: string[][];
}

export type BeliefPredicate = 'SUPPORTS' | 'CONTRADICTS' | 'DEPENDS_ON' | 'EXPLAINS';

export interface BeliefEdge {
  id: string;
  caseId: string;
  sourceId: string;
  targetId: string;
  predicate: BeliefPredicate;
  weight: number;
  sourceEvidenceIds: string[];
}

export type StatementStatus =
  'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'INFERRED' | 'DISPUTED' | 'UNKNOWN';

export interface ReconstructionStatement {
  id: string;
  timeLabel: string;
  text: string;
  status: StatementStatus;
  sourceIds: string[];
}

export interface CoverageBreakdown {
  observedDirectly: number;
  multiSourceSupported: number;
  inferred: number;
  unexplained: number;
}

export interface Reconstruction {
  id: string;
  caseId: string;
  title: string;
  eyebrow: string;
  summary: string;
  rank: number;
  isLeading: boolean;
  coveragePercent: number;
  coverageBreakdown: CoverageBreakdown;
  materialPoints: number;
  explainedPoints: number;
  contradictions: number;
  assumptions: number;
  statements: ReconstructionStatement[];
  hypothesisIds: string[];
  requiredAssumptionIds: string[];
  updatedAt: ISODateTime;
}

export type AnomalyStatus = 'open' | 'investigated' | 'resolved';

export interface Anomaly {
  id: string;
  caseId: string;
  question: string;
  category: 'who' | 'what' | 'when' | 'where' | 'why';
  detail: string;
  expectedInformationGain: number;
  status: AnomalyStatus;
  relatedIds: string[];
  lastResult: string | null;
}

export interface InvestigationStrategy {
  entityExpansion: boolean;
  temporalFilter: boolean;
  keywordSearch: boolean;
  semanticSearch: boolean;
  graphDepth: number;
}

export interface InvestigationAttempt {
  id: string;
  caseId: string;
  anomalyId: string;
  question: string;
  strategy: InvestigationStrategy;
  returnedEvidenceIds: string[];
  usefulEvidenceIds: string[];
  result: string;
  utilityScore: number;
  auditSteps: string[];
  createdAt: ISODateTime;
}

export type ResearchScope = 'case' | 'connected';

export type ResearchFindingStatus =
  'supported' | 'lead' | 'disputed' | 'retracted' | 'unknown';

/**
 * A locator read during an investigation. Connected locators are procedural
 * leads, not evidence artifacts: they must be preserved through ingestion
 * before they can support a world relationship.
 */
export interface ResearchSurfaceCheck {
  id: string;
  label: string;
  surface:
    | 'case-memory'
    | 'case-evidence'
    | 'case-graph'
    | 'case-timeline'
    | 'browser-history'
    | 'public-web'
    | 'connected-app'
    | 'web-archive';
  status: 'found' | 'checked-empty' | 'unavailable' | 'blocked';
  detail: string;
  locator: string | null;
  sourceId: string | null;
}

export interface ResearchFinding {
  id: string;
  label: string;
  detail: string;
  status: ResearchFindingStatus;
  confidence: number;
  sourceIds: string[];
  surfaceCheckIds: string[];
}

export interface ResearchNegativeFinding {
  id: string;
  label: string;
  detail: string;
  surfaceCheckIds: string[];
}

export interface ResearchCorrection {
  id: string;
  prior: string;
  corrected: string;
  reason: string;
  sourceIds: string[];
}

export interface CaseResearchSession {
  id: string;
  caseId: string;
  question: string;
  scope: ResearchScope;
  answer: string;
  answerStatus: 'bounded-answer' | 'lead-only' | 'insufficient';
  confidence: number;
  findings: ResearchFinding[];
  surfaceChecks: ResearchSurfaceCheck[];
  negativeFindings: ResearchNegativeFinding[];
  corrections: ResearchCorrection[];
  nextQuestions: string[];
  limitations: string[];
  provider: 'deterministic' | 'openrouter' | 'aside';
  model: string | null;
  packetId: string;
  runId: string;
  createdAt: ISODateTime;
  completedAt: ISODateTime;
}

export type MemoryKind = 'world' | 'evidence' | 'belief';

export interface CaseMemoryRecord {
  id: string;
  caseId: string;
  kind: MemoryKind;
  subjectId: string;
  summary: string;
  sourceIds: string[];
  confidence: number;
  revision: number;
  updatedAt: ISODateTime;
}

export interface CasePacket {
  id: string;
  caseId: string;
  question: string;
  retrievalMethod: 'atlas-rank-fusion' | 'local-bounded-fallback';
  exactMatchIds: string[];
  semanticMatchIds: string[];
  graphNeighborIds: string[];
  previousAttemptIds: string[];
  evidenceIds: string[];
  observationIds: string[];
  /**
   * Per-observation retrieval provenance. `matchedBy` records which real
   * retrieval pipeline returned the observation; it is never inferred from
   * the final text after ranking.
   */
  retrievalHits: Array<{
    observationId: string;
    evidenceId: string;
    rank: number;
    score: number | null;
    matchedBy: Array<'lexical' | 'semantic' | 'material-fallback'>;
  }>;
  strategy: InvestigationStrategy;
  createdAt: ISODateTime;
}

export type AgentName =
  | 'INGESTOR'
  | 'RESOLVER'
  | 'CHRONOLOGIST'
  | 'LINKER'
  | 'HYPOTHESIS ENGINE'
  | 'FALSIFIER'
  | 'INVESTIGATOR';

export interface AgentRunStep {
  id: string;
  agent: AgentName;
  status: 'completed' | 'skipped' | 'failed';
  detail: string;
  inputIds: string[];
  outputIds: string[];
  provider: 'deterministic' | 'fireworks' | 'openrouter' | 'elevenlabs' | 'aside';
  model: string | null;
  durationMs: number;
}

export interface AgentRun {
  id: string;
  caseId: string;
  trigger: string;
  status: 'completed' | 'failed';
  affectedIds: string[];
  packetId: string | null;
  checkpointThreadId: string | null;
  checkpointId: string | null;
  steps: AgentRunStep[];
  startedAt: ISODateTime;
  completedAt: ISODateTime;
}

export type AgentMissionStatus =
  'queued' | 'running' | 'waiting-for-review' | 'completed' | 'failed' | 'cancelled';

export type AgentMissionCapability =
  | 'recover-context'
  | 'rank-evidence'
  | 'investigate-anomaly'
  | 'connected-research'
  | 'challenge-account'
  | 'persist-run'
  | 'watch-for-change';

export interface AgentMissionStep {
  id: string;
  capability: AgentMissionCapability;
  label: string;
  detail: string;
  status: 'queued' | 'running' | 'completed' | 'skipped' | 'failed';
  inputIds: string[];
  outputIds: string[];
  startedAt: ISODateTime | null;
  completedAt: ISODateTime | null;
}

/**
 * A durable unit of investigator-directed work. A mission records the plan and
 * every completed capability separately from the model-facing run ledger.
 * External writes are never implied by a completed read/reasoning mission.
 */
export interface AgentMission {
  id: string;
  caseId: string;
  instruction: string;
  objective: string;
  scope: ResearchScope;
  status: AgentMissionStatus;
  initiatedBy: 'investigator' | 'evidence-intake' | 'standing-order' | 'imported-run';
  steps: AgentMissionStep[];
  summary: string | null;
  resultSessionId: string | null;
  runId: string | null;
  affectedIds: string[];
  reviewReason: string | null;
  createdAt: ISODateTime;
  startedAt: ISODateTime | null;
  completedAt: ISODateTime | null;
}

/** A persisted instruction that is re-run when new evidence enters the case. */
export interface StandingOrder {
  id: string;
  caseId: string;
  instruction: string;
  scope: ResearchScope;
  trigger: 'new-evidence';
  enabled: boolean;
  createdAt: ISODateTime;
  lastTriggeredAt: ISODateTime | null;
  lastMissionId: string | null;
}

export interface TemporalConstraint {
  id: string;
  caseId: string;
  sourceEventId: string;
  targetEventId: string;
  possibleRelations: Array<
    | 'before'
    | 'meets'
    | 'overlaps'
    | 'starts'
    | 'during'
    | 'finishes'
    | 'equals'
    | 'finished-by'
    | 'contains'
    | 'started-by'
    | 'overlapped-by'
    | 'met-by'
    | 'after'
  >;
  sourceIds: string[];
  status: 'consistent' | 'inconsistent';
}

export interface RevisionChange {
  id: string;
  kind: 'evidence' | 'reference' | 'edge' | 'assumption' | 'belief' | 'reconstruction';
  subjectId: string;
  label: string;
  before: string | null;
  after: string | null;
  direction: 'added' | 'raised' | 'lowered' | 'invalidated' | 'resolved';
}

export interface RevisionTraceStep {
  id: string;
  kind: 'evidence' | 'assumption' | 'event' | 'hypothesis' | 'reconstruction';
  label: string;
  relation: string;
}

export interface CaseRevision {
  id: string;
  caseId: string;
  sequence: number;
  createdAt: ISODateTime;
  title: string;
  summary: string;
  triggerEvidenceId: string | null;
  changes: RevisionChange[];
  trace: RevisionTraceStep[];
}

export interface CaseMetadata {
  id: string;
  title: string;
  subtitle: string;
  reference: string;
  classification: string;
  location: string;
  status: 'active' | 'archived';
  synthetic: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  revision: number;
}

export type EvidenceClarificationStatus = 'open' | 'answered';

export interface EvidenceClarificationChoice {
  id: string;
  label: string;
  description: string;
  recommended: boolean;
}

/**
 * A rare request for investigator judgment after the source has already been
 * preserved. Clarifications are procedural context: they never rewrite the
 * artifact or silently promote a claim into a world fact.
 */
export interface EvidenceClarification {
  id: string;
  caseId: string;
  evidenceId: string;
  kind: 'artifact-classification-conflict';
  question: string;
  detail: string;
  submittedKind: EvidenceKind;
  detectedKind: EvidenceKind;
  choices: EvidenceClarificationChoice[];
  allowCustomAnswer: boolean;
  status: EvidenceClarificationStatus;
  selectedChoiceId: string | null;
  customAnswer: string | null;
  createdAt: ISODateTime;
  answeredAt: ISODateTime | null;
}

export interface CaseState {
  schemaVersion: 1;
  metadata: CaseMetadata;
  evidence: EvidenceArtifact[];
  observations: Observation[];
  claims: Claim[];
  entities: Entity[];
  worldEdges: WorldEdge[];
  unresolvedReferences: UnresolvedReference[];
  assumptions: Assumption[];
  beliefs: Belief[];
  beliefEdges: BeliefEdge[];
  reconstructions: Reconstruction[];
  anomalies: Anomaly[];
  worldMemory: CaseMemoryRecord[];
  evidenceMemory: CaseMemoryRecord[];
  beliefMemory: CaseMemoryRecord[];
  proceduralMemory: InvestigationAttempt[];
  casePackets: CasePacket[];
  researchSessions: CaseResearchSession[];
  agentRuns: AgentRun[];
  missions: AgentMission[];
  standingOrders: StandingOrder[];
  clarifications: EvidenceClarification[];
  temporalConstraints: TemporalConstraint[];
  revisions: CaseRevision[];
}

export interface IntegrationStatus {
  id: 'mongodb' | 'fireworks' | 'openrouter' | 'elevenlabs' | 'aside';
  label: string;
  configured: boolean;
  active: boolean;
  detail: string;
  state?: 'ready' | 'degraded' | 'blocked' | 'unconfigured';
  verifiedAt?: ISODateTime | null;
}

export interface RuntimeCapability {
  id:
    | 'atlas-search'
    | 'atlas-vector-search'
    | 'rank-fusion'
    | 'graph-lookup'
    | 'change-streams'
    | 'langgraph-checkpoints'
    | 'local-embeddings'
    | 'data-integrity';
  label: string;
  active: boolean;
  detail: string;
}

export interface HealthStatus {
  ok: boolean;
  storageMode: 'local-json' | 'mongodb';
  engineLabel: string;
  integrations: IntegrationStatus[];
  capabilities?: RuntimeCapability[];
  dataIntegrity?: {
    ok: boolean;
    checkedCases: number;
    issueCount: number;
  };
}

export interface MutationResult {
  state: CaseState;
  revision: CaseRevision | null;
  auditSteps: string[];
}

export interface EvidenceIngestionReceipt {
  outcome: 'preserved' | 'duplicate';
  evidenceId: string;
  fileName: string;
  sha256: string;
  extractionStatus: ExtractionStatus;
  extractor: EvidenceArtifact['extractor'];
  observationCount: number;
  claimCount: number;
  unresolvedReferenceCount: number;
  warnings: string[];
  clarificationId: string | null;
}

export interface EvidenceIngestionResult extends MutationResult {
  receipt: EvidenceIngestionReceipt;
}
