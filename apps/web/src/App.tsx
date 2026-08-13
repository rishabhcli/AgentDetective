import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, LayoutDashboard, MessageCircleMore, X } from 'lucide-react';
import {
  sampleCaseId,
  type CaseMetadata,
  type CaseState,
  type HealthStatus,
  type ResearchScope,
} from '@thread/domain';
import {
  answerEvidenceClarification,
  challengeAssumption,
  createCase,
  deleteCase,
  fetchCase,
  fetchCases,
  fetchHealth,
  introduceCounterEvidence,
  investigate,
  rederiveCase,
  runMission,
  resetDemo,
  uploadEvidence,
  verifyIntegrations,
  type AgentMissionResult,
  type ResearchProgress,
} from './api.js';
import { Inspector } from './components/Inspector.js';
import { ChangeDrawer } from './components/ChangeDrawer.js';
import { UploadDrawer } from './components/UploadDrawer.js';
import { NewCaseDrawer, type NewCaseInput } from './components/NewCaseDrawer.js';
import { StatusDrawer } from './components/StatusDrawer.js';
import { ObservabilityDrawer } from './components/ObservabilityDrawer.js';
import { InterviewDrawer } from './components/InterviewDrawer.js';
import { ScenarioDrawer } from './components/ScenarioDrawer.js';
import { DeductionDrawer } from './components/DeductionDrawer.js';
import { LandingPage } from './components/LandingPage.js';
import { EvidenceCanvas } from './components/EvidenceCanvas.js';
import { AgentWorkspace } from './components/AgentWorkspace.js';
import { WorkspaceChrome } from './components/WorkspaceChrome.js';
import { CaseOpeningGuide } from './components/CaseOpeningGuide.js';
import {
  EvidenceProcessingNotice,
  type EvidenceNoticeState,
} from './components/EvidenceProcessingNotice.js';
import type { Scenario } from './scenarios.js';
import type { DrawerId, Selection } from './model.js';

function pendingClarificationNotice(state: CaseState): EvidenceNoticeState | null {
  const clarification = state.clarifications.find((item) => item.status === 'open');
  if (!clarification) return null;
  const artifact = state.evidence.find((item) => item.id === clarification.evidenceId);
  if (!artifact) return null;
  return {
    phase: 'complete',
    title: artifact.title,
    fileName: artifact.fileName,
    receipt: {
      outcome: 'preserved',
      evidenceId: artifact.id,
      fileName: artifact.fileName,
      sha256: artifact.sha256,
      extractionStatus: artifact.extractionStatus,
      extractor: artifact.extractor,
      observationCount: artifact.observationIds.length,
      claimCount: artifact.claimIds.length,
      unresolvedReferenceCount: state.unresolvedReferences.filter((reference) =>
        reference.sourceEvidenceIds.includes(artifact.id),
      ).length,
      warnings: [],
      clarificationId: clarification.id,
    },
    clarification,
  };
}

function selectionForSource(state: CaseState, id: string): Selection | null {
  if (state.evidence.some((item) => item.id === id)) return { type: 'evidence', id };
  if (state.observations.some((item) => item.id === id)) return { type: 'observation', id };
  if (state.claims.some((item) => item.id === id)) return { type: 'claim', id };
  if (state.entities.some((item) => item.id === id)) return { type: 'entity', id };
  if (state.worldEdges.some((item) => item.id === id)) return { type: 'edge', id };
  if (state.unresolvedReferences.some((item) => item.id === id))
    return { type: 'reference', id };
  if (state.assumptions.some((item) => item.id === id)) return { type: 'assumption', id };
  if (state.beliefs.some((item) => item.id === id)) return { type: 'belief', id };
  if (state.beliefEdges.some((item) => item.id === id)) return { type: 'belief-edge', id };
  return null;
}

export function App() {
  const [state, setState] = useState<CaseState | null>(null);
  const [cases, setCases] = useState<CaseMetadata[]>([]);
  const [activeCaseId, setActiveCaseId] = useState(() => {
    const match = window.location.hash.match(/^#case=(.+)$/u);
    return match?.[1] ? decodeURIComponent(match[1]) : sampleCaseId;
  });
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [hasEntered, setHasEntered] = useState(() =>
    window.location.hash.startsWith('#case'),
  );
  const [showCaseGuide, setShowCaseGuide] = useState(
    () => window.location.hash !== '#case',
  );
  const [entryDestination, setEntryDestination] = useState<'board' | 'agents'>('board');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [drawer, setDrawer] = useState<DrawerId>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [auditSteps, setAuditSteps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pulseRevision, setPulseRevision] = useState(0);
  const [evidenceNotice, setEvidenceNotice] = useState<EvidenceNoticeState | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [nextState, nextHealth, nextCases] = await Promise.all([
          fetchCase(activeCaseId, signal),
          fetchHealth(signal),
          fetchCases(signal),
        ]);
        setState(nextState);
        setHealth(nextHealth);
        setCases(nextCases);
        setEvidenceNotice((current) => current ?? pendingClarificationNotice(nextState));
        setError(null);
      } catch (cause) {
        if ((cause as Error).name !== 'AbortError') {
          setError(
            cause instanceof Error ? cause.message : 'THREAD could not load the case.',
          );
        }
      }
    },
    [activeCaseId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const runAction = useCallback(
    async (
      id: string,
      action: () => Promise<{ state: CaseState; auditSteps: string[] }>,
    ) => {
      if (busyAction) return;
      setBusyAction(id);
      setError(null);
      try {
        const result = await action();
        setState(result.state);
        setAuditSteps(result.auditSteps);
        setPulseRevision((value) => value + 1);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The case action failed.');
        throw cause;
      } finally {
        setBusyAction(null);
      }
    },
    [busyAction],
  );

  const handleInvestigate = useCallback(
    async (anomalyId: string) => {
      if (!state) return;
      try {
        await runAction(`investigate:${anomalyId}`, () =>
          investigate(state.metadata.id, anomalyId),
        );
      } catch {
        // The surfaced error banner is the sole user-facing error path.
      }
    },
    [runAction, state],
  );

  const handleCounterEvidence = useCallback(async () => {
    if (!state) return;
    try {
      await runAction('counter-evidence', () =>
        introduceCounterEvidence(state.metadata.id),
      );
      setDrawer('changes');
    } catch {
      // The surfaced error banner is the sole user-facing error path.
    }
  }, [runAction, state]);

  const handleRunScenario = useCallback(
    async (scenario: Scenario) => {
      if (!state) return;
      // Each guided path performs the same request as its corresponding control.
      const action = scenario.action;
      try {
        if (action.kind === 'investigate') {
          await runAction(`scenario:${scenario.id}`, () =>
            investigate(state.metadata.id, action.anomalyId),
          );
        } else if (action.kind === 'counter-evidence') {
          await runAction(`scenario:${scenario.id}`, () =>
            introduceCounterEvidence(state.metadata.id),
          );
          setDrawer('changes');
        } else if (action.kind === 'reveal-agents') {
          document.querySelector<HTMLElement>('.agent-workspace')?.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'start',
          });
          setDrawer(null);
        } else {
          setDrawer(action.drawer);
        }
      } catch {
        // The surfaced error banner is the sole user-facing error path.
      }
    },
    [runAction, state],
  );

  const handleUpload = useCallback(
    async (form: FormData) => {
      if (!state || busyAction) return;
      const file = form.get('file');
      const fileName = file instanceof File ? file.name : 'Evidence artifact';
      const titleEntry = form.get('title');
      const title =
        typeof titleEntry === 'string' && titleEntry.trim() ? titleEntry : fileName;
      setEvidenceNotice({ phase: 'processing', title, fileName });
      setBusyAction('upload');
      setError(null);
      try {
        const result = await uploadEvidence(state.metadata.id, form);
        const clarification = result.receipt.clarificationId
          ? (result.state.clarifications.find(
              (item) => item.id === result.receipt.clarificationId,
            ) ?? null)
          : null;
        setState(result.state);
        setAuditSteps(result.auditSteps);
        if (result.revision) setPulseRevision((value) => value + 1);
        setEvidenceNotice({
          phase: 'complete',
          title,
          fileName,
          receipt: result.receipt,
          clarification,
        });
        setDrawer(null);
      } catch (cause) {
        setEvidenceNotice(null);
        const message =
          cause instanceof Error ? cause.message : 'Evidence ingestion failed.';
        setError(message);
        throw cause;
      } finally {
        setBusyAction(null);
      }
    },
    [busyAction, state],
  );

  const handleClarificationAnswer = useCallback(
    async (clarificationId: string, choiceId: string, customAnswer?: string) => {
      if (!state || busyAction) throw new Error('Another case transform is running.');
      setBusyAction('clarification');
      setError(null);
      try {
        const result = await answerEvidenceClarification(
          state.metadata.id,
          clarificationId,
          choiceId,
          customAnswer,
        );
        setState(result.state);
        setAuditSteps(result.auditSteps);
        setEvidenceNotice((current) =>
          current?.phase === 'complete' && current.clarification?.id === clarificationId
            ? { ...current, clarification: result.clarification }
            : current,
        );
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : 'The clarification was not recorded.';
        setError(message);
        throw cause;
      } finally {
        setBusyAction(null);
      }
    },
    [busyAction, state],
  );

  const handleMission = useCallback(
    async (
      instruction: string,
      scope: ResearchScope,
      onProgress: (progress: ResearchProgress) => void,
    ): Promise<AgentMissionResult> => {
      if (!state) throw new Error('The case is not loaded.');
      if (busyAction) throw new Error('Another case transform is already running.');
      setBusyAction('agent-mission');
      setError(null);
      try {
        const result = await runMission(state.metadata.id, instruction, scope, onProgress);
        setState(result.state);
        setAuditSteps(result.auditSteps);
        return result;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'The mission failed.';
        setError(message);
        throw cause;
      } finally {
        setBusyAction(null);
      }
    },
    [busyAction, state],
  );

  const handleVerify = useCallback(async () => {
    setBusyAction('verify-integrations');
    setError(null);
    try {
      setHealth(await verifyIntegrations());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Provider verification failed.');
    } finally {
      setBusyAction(null);
    }
  }, []);

  const handleReset = useCallback(async () => {
    if (busyAction) return;
    setBusyAction('reset');
    setError(null);
    try {
      const resetState = await resetDemo(state?.metadata.id);
      setState(resetState);
      setSelection(null);
      setAuditSteps([]);
      setEvidenceNotice(null);
      setDrawer(null);
      setPulseRevision((value) => value + 1);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'The sample case could not be reset.',
      );
    } finally {
      setBusyAction(null);
    }
  }, [busyAction, state]);

  const handleChallenge = useCallback(
    async (assumptionId: string) => {
      if (!state) return;
      try {
        await runAction(`challenge:${assumptionId}`, () =>
          challengeAssumption(state.metadata.id, assumptionId),
        );
        setDrawer('changes');
        setSelection(null);
      } catch {
        // The surfaced error banner is the sole user-facing error path.
      }
    },
    [runAction, state],
  );

  const handleRederive = useCallback(async () => {
    if (!state) return;
    try {
      await runAction('rederive', () => rederiveCase(state.metadata.id));
    } catch {
      // The surfaced error banner is the sole user-facing error path.
    }
  }, [runAction, state]);

  const counterEvidencePresent = useMemo(
    () => Boolean(state?.evidence.some((item) => item.id === 'EV-143')),
    [state],
  );

  const chooseCase = useCallback(
    (caseId: string) => {
      if (caseId === activeCaseId) return;
      setSelection(null);
      setDrawer(null);
      setAuditSteps([]);
      setEvidenceNotice(null);
      setState(null);
      setActiveCaseId(caseId);
      if (hasEntered) {
        window.history.replaceState(
          null,
          '',
          caseId === sampleCaseId ? '#case' : `#case=${encodeURIComponent(caseId)}`,
        );
        setShowCaseGuide(true);
      }
    },
    [activeCaseId, hasEntered],
  );

  const handleNewCase = useCallback(
    async (input: NewCaseInput) => {
      if (busyAction) return;
      setBusyAction('new-case');
      setError(null);
      try {
        const created = await createCase(input);
        setCases(await fetchCases());
        setDrawer(null);
        chooseCase(created.metadata.id);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The case was not opened.');
        throw cause;
      } finally {
        setBusyAction(null);
      }
    },
    [busyAction, chooseCase],
  );

  const handleDeleteCase = useCallback(async () => {
    if (!state || busyAction) return;
    const removed = state.metadata.id;
    setBusyAction('delete-case');
    setError(null);
    try {
      await deleteCase(removed);
      const remaining = await fetchCases();
      setCases(remaining);
      const next = remaining[0]?.id ?? sampleCaseId;
      chooseCase(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The case was not deleted.');
    } finally {
      setBusyAction(null);
    }
  }, [busyAction, chooseCase, state]);

  const enterWorkspace = useCallback(() => {
    window.history.replaceState(
      null,
      '',
      state?.metadata.id === sampleCaseId
        ? '#case'
        : `#case=${encodeURIComponent(state?.metadata.id ?? activeCaseId)}`,
    );
    setEntryDestination('board');
    setHasEntered(true);
    setShowCaseGuide(true);
  }, [activeCaseId, state?.metadata.id]);

  const enterAgents = useCallback(() => {
    window.history.replaceState(
      null,
      '',
      state?.metadata.id === sampleCaseId
        ? '#case'
        : `#case=${encodeURIComponent(state?.metadata.id ?? activeCaseId)}`,
    );
    setEntryDestination('agents');
    setHasEntered(true);
    setShowCaseGuide(true);
  }, [activeCaseId, state?.metadata.id]);

  const returnHome = useCallback(() => {
    window.history.replaceState(null, '', window.location.pathname);
    setHasEntered(false);
    setShowCaseGuide(false);
    setDrawer(null);
    setEvidenceNotice((current) =>
      current?.phase === 'complete' && current.clarification?.status === 'open'
        ? current
        : null,
    );
  }, []);

  const completeCaseGuide = useCallback(() => {
    setShowCaseGuide(false);
    if (entryDestination !== 'agents') return;
    window.setTimeout(() => {
      document
        .getElementById('case-workspace')
        ?.scrollTo({ left: window.innerWidth, behavior: 'smooth' });
      document.getElementById('integrated-agent-question')?.focus();
    }, 420);
  }, [entryDestination]);

  if (!state) {
    return (
      <main className="boot-screen">
        <div className="boot-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="kicker">THREAD / CASE ENGINE</p>
        <h1>{error ? 'The case could not be opened.' : 'Assembling the case model…'}</h1>
        {error ? (
          <>
            <p className="boot-error">{error}</p>
            <button className="button button-primary" onClick={() => void load()}>
              Retry connection
            </button>
          </>
        ) : (
          <p>Evidence remains separate from claims, entities, and beliefs.</p>
        )}
      </main>
    );
  }

  if (!hasEntered) {
    return (
      <LandingPage
        state={state}
        cases={cases}
        health={health}
        onEnter={enterWorkspace}
        onAskAgents={enterAgents}
        onChooseCase={chooseCase}
      />
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#case-workspace">
        Skip to case workspace
      </a>
      <WorkspaceChrome
        state={state}
        health={health}
        busyAction={busyAction}
        counterEvidencePresent={counterEvidencePresent}
        onHome={returnHome}
        onChanges={() => setDrawer('changes')}
        onStatus={() => setDrawer('status')}
        onCounterEvidence={() => void handleCounterEvidence()}
        onScenarios={() => setDrawer('scenarios')}
        onDeductions={() => setDrawer('deductions')}
        onReset={() => void handleReset()}
        onNewCase={() => setDrawer('new-case')}
        onRederive={() => void handleRederive()}
        onDeleteCase={() => void handleDeleteCase()}
        cases={cases}
        onChooseCase={chooseCase}
      />
      <main id="case-workspace" className="case-workspace">
        <EvidenceCanvas
          key={`board-${state.metadata.revision}-${pulseRevision}`}
          state={state}
          selection={selection}
          pulse={pulseRevision}
          busyAction={busyAction}
          onSelect={setSelection}
          onUpload={() => setDrawer('upload')}
          onInvestigate={(id) => void handleInvestigate(id)}
        />
        <AgentWorkspace
          key={`agents-${state.metadata.id}`}
          state={state}
          health={health}
          busyAction={busyAction}
          auditSteps={auditSteps}
          onResearch={handleMission}
          onInterview={() => setDrawer('interview')}
          onLedger={() => setDrawer('observability')}
          onInspect={(id) => {
            const nextSelection = selectionForSource(state, id);
            if (nextSelection) setSelection(nextSelection);
          }}
        />
      </main>
      {!showCaseGuide && !selection && drawer === null ? (
        <nav className="mobile-workspace-switcher" aria-label="Mobile workspace view">
          <button
            onClick={() =>
              document
                .getElementById('case-workspace')
                ?.scrollTo({ left: 0, behavior: 'smooth' })
            }
          >
            <LayoutDashboard size={14} aria-hidden="true" /> Board
          </button>
          <button
            onClick={() =>
              document
                .getElementById('case-workspace')
                ?.scrollTo({ left: window.innerWidth, behavior: 'smooth' })
            }
          >
            <MessageCircleMore size={14} aria-hidden="true" /> Agents
          </button>
        </nav>
      ) : null}

      <AnimatePresence>
        {showCaseGuide ? (
          <CaseOpeningGuide
            key="case-opening-guide"
            state={state}
            destination={entryDestination}
            onComplete={completeCaseGuide}
            onBack={returnHome}
          />
        ) : null}
        {selection ? (
          <Inspector
            key={`${selection.type}:${selection.id}`}
            state={state}
            selection={selection}
            onSelect={setSelection}
            onClose={() => setSelection(null)}
            onChallenge={(assumptionId) => void handleChallenge(assumptionId)}
            challengeBusy={busyAction?.startsWith('challenge:') ?? false}
          />
        ) : null}
        {drawer === 'changes' ? (
          <ChangeDrawer
            key="changes"
            state={state}
            onSelect={setSelection}
            onClose={() => setDrawer(null)}
          />
        ) : null}
        {drawer === 'new-case' ? (
          <NewCaseDrawer
            key="new-case"
            busy={busyAction === 'new-case'}
            onSubmit={handleNewCase}
            onClose={() => setDrawer(null)}
          />
        ) : null}
        {drawer === 'upload' ? (
          <UploadDrawer
            key="upload"
            busy={busyAction === 'upload'}
            onSubmit={handleUpload}
            onClose={() => setDrawer(null)}
          />
        ) : null}
        {drawer === 'status' && health ? (
          <StatusDrawer
            key="status"
            health={health}
            busy={busyAction === 'verify-integrations'}
            onVerify={() => void handleVerify()}
            onClose={() => setDrawer(null)}
          />
        ) : null}
        {drawer === 'observability' ? (
          <ObservabilityDrawer
            key="observability"
            state={state}
            health={health}
            onClose={() => setDrawer(null)}
          />
        ) : null}
        {drawer === 'deductions' ? (
          <DeductionDrawer
            key="deductions"
            state={state}
            onSelect={setSelection}
            onClose={() => setDrawer(null)}
          />
        ) : null}
        {drawer === 'scenarios' ? (
          <ScenarioDrawer
            key="scenarios"
            state={state}
            health={health}
            busyAction={busyAction}
            auditSteps={auditSteps}
            onRun={(scenario) => void handleRunScenario(scenario)}
            onClose={() => setDrawer(null)}
          />
        ) : null}
      </AnimatePresence>

      <InterviewDrawer
        caseId={state.metadata.id}
        active={drawer === 'interview'}
        onClose={() => setDrawer(null)}
      />

      <AnimatePresence>
        {evidenceNotice ? (
          <EvidenceProcessingNotice
            key={
              evidenceNotice.phase === 'complete'
                ? evidenceNotice.receipt.evidenceId
                : evidenceNotice.fileName
            }
            notice={evidenceNotice}
            onClose={() => setEvidenceNotice(null)}
            onInspect={(evidenceId) => {
              setEvidenceNotice(null);
              setSelection({ type: 'evidence', id: evidenceId });
            }}
            onChanges={() => {
              setEvidenceNotice(null);
              setDrawer('changes');
            }}
            onAnswer={handleClarificationAnswer}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {error ? (
          <motion.div
            className="error-toast"
            role="alert"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
          >
            <AlertTriangle size={17} aria-hidden="true" />
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError(null)}>
              <X size={15} aria-hidden="true" />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
