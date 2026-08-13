import type { CaseState, HealthStatus, IntegrationStatus, LensId } from '@thread/domain';

export type ScenarioAction =
  | { kind: 'investigate'; anomalyId: string }
  | { kind: 'counter-evidence' }
  | { kind: 'reveal-agents' }
  | { kind: 'open-drawer'; drawer: 'upload' | 'interview' };

export interface Scenario {
  id: string;
  index: string;
  title: string;
  question: string;
  proves: string;
  runtime: string;
  /** Remote adapter this scenario depends on, or null when it is deterministic. */
  requires: IntegrationStatus['id'] | null;
  lens: LensId;
  action: ScenarioAction;
  steps: string[];
  cta: string;
}

export const scenarios: Scenario[] = [
  {
    id: 'identity',
    index: '01',
    title: 'Identity stays a distribution',
    question: 'Who is “J”?',
    proves:
      'An uncertain reference keeps competing candidate bindings with explicit signals instead of being merged into one convenient person.',
    runtime: 'Deterministic reasoning · Atlas hybrid retrieval · LangGraph checkpoint',
    requires: null,
    lens: 'people',
    action: { kind: 'investigate', anomalyId: 'AN-J' },
    steps: [
      'Assemble a bounded case packet with Atlas Search, Vector Search and $rankFusion.',
      'Score candidate bindings from resolution signals rather than name similarity.',
      'Persist the run as a LangGraph checkpoint with the transforms it actually used.',
    ],
    cta: 'Run identity investigation',
  },
  {
    id: 'cascade',
    index: '02',
    title: 'One artifact moves the whole board',
    question: 'What happens when a second camera contradicts the leading account?',
    proves:
      'Invalidating a single assumption cascades through ATMS environments, edge confidence and the ranking of competing reconstructions.',
    runtime: 'Deterministic reasoning · affected-subgraph revision · Atlas persistence',
    requires: null,
    lens: 'theory',
    action: { kind: 'counter-evidence' },
    steps: [
      'Ingest Evidence 143 as an immutable artifact that challenges EV-058.',
      'Invalidate assumption A-19 and drop every belief environment that depended on it.',
      'Re-rank the reconstructions and open the evidence → assumption → belief trace.',
    ],
    cta: 'Introduce Evidence 143',
  },
  {
    id: 'adversarial',
    index: '03',
    title: 'Two model families attack the case',
    question: 'Does the badge record actually establish who walked through the door?',
    proves:
      'Model output is treated as belief memory under schema validation, never promoted to evidence or a world fact.',
    runtime: 'OpenRouter · two independent model families · bounded case packet',
    requires: 'openrouter',
    lens: 'theory',
    action: { kind: 'reveal-agents' },
    steps: [
      'Send only the bounded packet, not the whole case, to both models.',
      'Validate each response against a schema that names the reconstructions that exist.',
      'Store both opinions as belief memory with their model attribution.',
    ],
    cta: 'Open integrated agents',
  },
  {
    id: 'visual',
    index: '04',
    title: 'A photograph is not a fact',
    question: 'What can actually be seen in this frame?',
    proves:
      'Visual extraction produces atomic observations with locators and uncertainty, and the original artifact is preserved with its digest.',
    runtime: 'Fireworks vision model · EXIF and GPS metadata · SHA-256 preservation',
    requires: 'fireworks',
    lens: 'evidence',
    action: { kind: 'open-drawer', drawer: 'upload' },
    steps: [
      'Preserve the upload byte-for-byte and record its SHA-256 before extraction.',
      'Read embedded EXIF timestamp and GPS as source signals, not as ground truth.',
      'Ask the vision model for observations that separate what is visible from inference.',
    ],
    cta: 'Open evidence intake',
  },
  {
    id: 'witness',
    index: '05',
    title: 'A conversation is not evidence yet',
    question: 'What does the witness actually claim?',
    proves:
      'A live interview is investigative input; it only becomes a case artifact once a recording is ingested with provenance.',
    runtime: 'ElevenLabs · signed session · case keyterms synced to ASR',
    requires: 'elevenlabs',
    lens: 'people',
    action: { kind: 'open-drawer', drawer: 'interview' },
    steps: [
      'Mint a signed session server-side so the API key never reaches the browser.',
      'Sync case keyterms so names and identifiers survive transcription.',
      'Keep the transcript out of the world model until it is ingested as an artifact.',
    ],
    cta: 'Open the witness room',
  },
];

export type ScenarioAvailability =
  | { state: 'ready'; detail: string }
  | { state: 'already-run'; detail: string }
  | { state: 'unavailable'; detail: string };

/**
 * Availability is read from live runtime state, never assumed. A scenario that
 * depends on an adapter that is not active must say so instead of failing
 * halfway through a demonstration.
 */
export function scenarioAvailability(
  scenario: Scenario,
  state: CaseState,
  health: HealthStatus | null,
): ScenarioAvailability {
  if (scenario.requires) {
    const integration = health?.integrations.find((item) => item.id === scenario.requires);
    if (!integration) {
      return { state: 'unavailable', detail: 'Runtime status has not been read yet.' };
    }
    if (!integration.active) {
      return { state: 'unavailable', detail: integration.detail };
    }
  }

  const action = scenario.action;
  if (action.kind === 'investigate') {
    const anomaly = state.anomalies.find((item) => item.id === action.anomalyId);
    if (anomaly && anomaly.status !== 'open') {
      return {
        state: 'already-run',
        detail: 'Already recorded in this case. Reset the sample to replay it.',
      };
    }
  }

  if (action.kind === 'counter-evidence') {
    if (state.evidence.some((item) => item.id === 'EV-143')) {
      return {
        state: 'already-run',
        detail: 'Evidence 143 is already part of this case. Reset the sample to replay it.',
      };
    }
  }

  return {
    state: 'ready',
    detail: scenario.requires
      ? 'The adapter this scenario needs is live.'
      : 'Runs against the local deterministic engine.',
  };
}
