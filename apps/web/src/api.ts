import type {
  AgentRun,
  AgentMission,
  CasePacket,
  CaseMetadata,
  CaseResearchSession,
  CaseState,
  EvidenceClarification,
  EvidenceIngestionResult,
  HealthStatus,
  MutationResult,
  ResearchScope,
} from '@thread/domain';

export interface AdversarialReviewResult {
  state: CaseState;
  packet: CasePacket;
  run: AgentRun;
  review: {
    hypothesis: {
      summary: string;
      leading_reconstruction_id: string;
      diagnostic_evidence_ids: string[];
      unresolved_assumptions: string[];
      next_question: string;
    };
    falsifier: {
      strongest_counterargument: string;
      contradicting_ids: string[];
      alternative_reconstruction_id: string;
      stop_believing_if: string;
    };
    hypothesisModel: string;
    falsifierModel: string;
  };
  auditSteps: string[];
}

export interface CaseResearchResult {
  state: CaseState;
  packet: CasePacket;
  run: AgentRun;
  session: CaseResearchSession;
  auditSteps: string[];
}

export interface AgentMissionResult extends CaseResearchResult {
  mission: AgentMission;
}

export interface ResearchProgress {
  id: 'context' | 'retrieval' | 'connected' | 'reasoning' | 'challenge' | 'checkpoint';
  label: string;
  detail: string;
  status: 'active' | 'completed';
}

export interface InterviewSession {
  signedUrl: string;
  agentId: string;
  keyterms: string[];
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(body.error ?? `Request failed with status ${response.status}.`);
  return body;
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthStatus> {
  return readJson<HealthStatus>(await fetch('/api/health', signal ? { signal } : {}));
}

export async function verifyIntegrations(): Promise<HealthStatus> {
  return readJson<HealthStatus>(
    await fetch('/api/integrations/verify', { method: 'POST' }),
  );
}

export async function fetchCase(caseId: string, signal?: AbortSignal): Promise<CaseState> {
  const result = await readJson<{ state: CaseState }>(
    await fetch(`/api/cases/${encodeURIComponent(caseId)}`, signal ? { signal } : {}),
  );
  return result.state;
}

export async function fetchCases(signal?: AbortSignal): Promise<CaseMetadata[]> {
  const result = await readJson<{ cases: CaseMetadata[] }>(
    await fetch('/api/cases', signal ? { signal } : {}),
  );
  return result.cases;
}

export async function investigate(
  caseId: string,
  anomalyId: string,
): Promise<MutationResult> {
  return readJson<MutationResult>(
    await fetch(
      `/api/cases/${encodeURIComponent(caseId)}/investigations/${encodeURIComponent(anomalyId)}`,
      { method: 'POST' },
    ),
  );
}

export async function introduceCounterEvidence(caseId: string): Promise<MutationResult> {
  return readJson<MutationResult>(
    await fetch(`/api/cases/${encodeURIComponent(caseId)}/evidence/demo-143`, {
      method: 'POST',
    }),
  );
}

export async function uploadEvidence(
  caseId: string,
  form: FormData,
): Promise<EvidenceIngestionResult> {
  return readJson<EvidenceIngestionResult>(
    await fetch(`/api/cases/${encodeURIComponent(caseId)}/evidence`, {
      method: 'POST',
      body: form,
    }),
  );
}

export async function answerEvidenceClarification(
  caseId: string,
  clarificationId: string,
  choiceId: string,
  customAnswer?: string,
): Promise<{
  state: CaseState;
  clarification: EvidenceClarification;
  auditSteps: string[];
}> {
  return readJson(
    await fetch(
      `/api/cases/${encodeURIComponent(caseId)}/evidence/clarifications/${encodeURIComponent(clarificationId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choiceId, ...(customAnswer ? { customAnswer } : {}) }),
      },
    ),
  );
}

export async function requestAdversarialReview(
  caseId: string,
  question: string,
): Promise<AdversarialReviewResult> {
  return readJson<AdversarialReviewResult>(
    await fetch(`/api/cases/${encodeURIComponent(caseId)}/reasoning/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    }),
  );
}

export async function researchCase(
  caseId: string,
  question: string,
  scope: ResearchScope,
  onProgress: (progress: ResearchProgress) => void,
): Promise<CaseResearchResult> {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/research/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, scope }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Research failed with status ${response.status}.`);
  }
  if (!response.body) throw new Error('The research stream did not open.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: CaseResearchResult | null = null;
  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    const message = JSON.parse(line) as
      | { type: 'progress'; progress: ResearchProgress }
      | { type: 'complete'; result: CaseResearchResult }
      | { type: 'error'; error: string };
    if (message.type === 'progress') onProgress(message.progress);
    else if (message.type === 'complete') result = message.result;
    else throw new Error(message.error);
  };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) consumeLine(line);
    if (done) break;
  }
  if (buffer.trim()) consumeLine(buffer);
  if (!result) throw new Error('Research ended before a persisted result was returned.');
  return result;
}

export async function runMission(
  caseId: string,
  instruction: string,
  scope: ResearchScope,
  onProgress: (progress: ResearchProgress) => void,
): Promise<AgentMissionResult> {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/missions/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction, scope }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Mission failed with status ${response.status}.`);
  }
  if (!response.body) throw new Error('The mission stream did not open.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: AgentMissionResult | null = null;
  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    const message = JSON.parse(line) as
      | { type: 'progress'; progress: ResearchProgress }
      | { type: 'complete'; result: AgentMissionResult }
      | { type: 'error'; error: string };
    if (message.type === 'progress') onProgress(message.progress);
    else if (message.type === 'complete') result = message.result;
    else throw new Error(message.error);
  };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) consumeLine(line);
    if (done) break;
  }
  if (buffer.trim()) consumeLine(buffer);
  if (!result) throw new Error('Mission ended before a persisted result was returned.');
  return result;
}

export async function requestInterviewSession(caseId: string): Promise<InterviewSession> {
  return readJson<InterviewSession>(
    await fetch(`/api/cases/${encodeURIComponent(caseId)}/interview/session`),
  );
}

export async function resetDemo(caseId?: string): Promise<CaseState> {
  const result = await readJson<{ state: CaseState }>(
    await fetch(
      caseId ? `/api/cases/${encodeURIComponent(caseId)}/reset` : '/api/demo/reset',
      { method: 'POST' },
    ),
  );
  return result.state;
}
