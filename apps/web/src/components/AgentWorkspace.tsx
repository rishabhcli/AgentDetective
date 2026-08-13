import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BorderBeam } from 'border-beam';
import { ThinkingOrb } from 'thinking-orbs';
import {
  Activity,
  AudioLines,
  Check,
  ChevronRight,
  CircleDashed,
  CircleSlash2,
  Clock3,
  Database,
  ExternalLink,
  FileSearch,
  Globe2,
  History,
  LoaderCircle,
  MessageCircleMore,
  Radar,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  TriangleAlert,
} from 'lucide-react';
import type {
  AgentName,
  CaseState,
  HealthStatus,
  ResearchScope,
  ResearchSurfaceCheck,
} from '@thread/domain';
import type { AgentMissionResult, ResearchProgress } from '../api.js';

interface AgentWorkspaceProps {
  state: CaseState;
  health: HealthStatus | null;
  busyAction: string | null;
  auditSteps: string[];
  onResearch: (
    instruction: string,
    scope: ResearchScope,
    onProgress: (progress: ResearchProgress) => void,
  ) => Promise<AgentMissionResult>;
  onInterview: () => void;
  onLedger: () => void;
  onInspect: (id: string) => void;
}

function startingInstruction(state: CaseState): string {
  const next = state.anomalies
    .filter((item) => item.status === 'open')
    .sort((a, b) => b.expectedInformationGain - a.expectedInformationGain)[0];
  return next
    ? `Investigate this specific gap: ${next.question} Return the sources checked and the record that would resolve it.`
    : 'Test the leading account against every opposing source in this case.';
}

const agentProfiles: Array<{
  name: AgentName;
  label: string;
  verb: string;
  orb:
    | 'working'
    | 'searching'
    | 'solving'
    | 'listening'
    | 'connecting'
    | 'weaving'
    | 'composing';
}> = [
  { name: 'INGESTOR', label: 'Ingestor', verb: 'preserves', orb: 'composing' },
  { name: 'RESOLVER', label: 'Resolver', verb: 'disambiguates', orb: 'connecting' },
  { name: 'CHRONOLOGIST', label: 'Chronologist', verb: 'compares time', orb: 'weaving' },
  { name: 'LINKER', label: 'Linker', verb: 'expands orbit', orb: 'connecting' },
  { name: 'HYPOTHESIS ENGINE', label: 'Hypothesis', verb: 'explains', orb: 'solving' },
  { name: 'FALSIFIER', label: 'Falsifier', verb: 'challenges', orb: 'searching' },
  { name: 'INVESTIGATOR', label: 'Investigator', verb: 'chooses next', orb: 'working' },
];

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function surfaceIcon(surface: ResearchSurfaceCheck['surface']) {
  if (surface === 'browser-history') return History;
  if (surface === 'public-web' || surface === 'web-archive') return Globe2;
  if (surface === 'connected-app') return Radar;
  if (surface === 'case-timeline') return Clock3;
  if (surface === 'case-graph') return Target;
  return FileSearch;
}

function isHttpLocator(locator: string | null): locator is string {
  return Boolean(locator && /^https?:\/\//u.test(locator));
}

export function AgentWorkspace({
  state,
  health,
  busyAction,
  auditSteps,
  onResearch,
  onInterview,
  onLedger,
  onInspect,
}: AgentWorkspaceProps) {
  const [question, setQuestion] = useState(() => startingInstruction(state));
  const [scope, setScope] = useState<ResearchScope>('case');
  const [result, setResult] = useState<AgentMissionResult | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ResearchProgress[]>([]);
  const [error, setError] = useState<string | null>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const researchBusy = busyAction === 'agent-mission';
  const connectedReady =
    health?.integrations.some(
      (integration) => integration.id === 'aside' && integration.active,
    ) ?? false;
  const voiceReady =
    health?.integrations.some(
      (integration) => integration.id === 'elevenlabs' && integration.active,
    ) ?? false;
  const sessions = useMemo(() => {
    const stored = state.researchSessions ?? [];
    if (!result || stored.some((session) => session.id === result.session.id))
      return stored;
    return [result.session, ...stored];
  }, [result, state.researchSessions]);
  const missions = useMemo(() => {
    const stored = state.missions ?? [];
    if (!result || stored.some((mission) => mission.id === result.mission.id))
      return stored;
    return [result.mission, ...stored];
  }, [result, state.missions]);
  const session =
    sessions.find((item) => item.id === selectedSessionId) ?? sessions[0] ?? null;
  const sessionRun = session
    ? state.agentRuns.find((run) => run.id === session.runId)
    : state.agentRuns[0];
  const sessionMission = session
    ? missions.find((mission) => mission.resultSessionId === session.id)
    : missions[0];
  const sessionPacket = session
    ? state.casePackets.find((packet) => packet.id === session.packetId)
    : null;
  const stepByAgent = useMemo(
    () => new Map(sessionRun?.steps.map((step) => [step.agent, step] as const) ?? []),
    [sessionRun],
  );
  const inspectableIds = useMemo(
    () =>
      new Set([
        ...state.evidence.map((item) => item.id),
        ...state.observations.map((item) => item.id),
        ...state.claims.map((item) => item.id),
        ...state.entities.map((item) => item.id),
        ...state.worldEdges.map((item) => item.id),
        ...state.unresolvedReferences.map((item) => item.id),
        ...state.assumptions.map((item) => item.id),
        ...state.beliefs.map((item) => item.id),
        ...state.beliefEdges.map((item) => item.id),
      ]),
    [state],
  );
  const suggestedObjectives = useMemo(() => {
    const openQuestions = state.anomalies
      .filter((item) => item.status === 'open')
      .slice()
      .sort((a, b) => b.expectedInformationGain - a.expectedInformationGain)
      .slice(0, 2)
      .map(
        (item) =>
          `Investigate: ${item.question} Return the exact source or record needed to resolve it.`,
      );
    const leading = state.reconstructions.find((item) => item.isLeading);
    return [
      ...openQuestions,
      ...(leading
        ? [`Test “${leading.title}” against every opposing source in the case.`]
        : []),
    ].slice(0, 3);
  }, [state.anomalies, state.reconstructions]);

  useEffect(() => {
    if (!researchBusy && !result) return;
    conversationRef.current?.scrollTo({
      top: researchBusy ? conversationRef.current.scrollHeight : 0,
      behavior: 'smooth',
    });
  }, [progress, researchBusy, result]);

  useEffect(() => {
    if (!selectedSessionId) return;
    conversationRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [selectedSessionId]);

  function recordProgress(next: ResearchProgress) {
    setProgress((current) => {
      const index = current.findIndex((item) => item.id === next.id);
      if (index === -1) return [...current, next];
      const copy = [...current];
      copy[index] = next;
      return copy;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (scope === 'connected' && !connectedReady) {
      setError(
        'Connected browser research is unavailable. Case-file research still works.',
      );
      return;
    }
    setError(null);
    setProgress([]);
    try {
      const next = await onResearch(question, scope, recordProgress);
      setResult(next);
      setSelectedSessionId(next.session.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The mission failed.');
    }
  }

  function askNext(next: string) {
    setQuestion(next);
    document.getElementById('integrated-agent-question')?.focus();
  }

  return (
    <aside
      className="agent-workspace agent-research-workspace"
      aria-label="Case agent conversation"
    >
      <header className="agent-workspace-header research-header">
        <div>
          <span className="agent-live-dot" aria-hidden="true" />
          <span>
            <strong>THREAD agents</strong>
            <small>{researchBusy ? 'Working the case' : 'Ready'}</small>
          </span>
        </div>
        <button
          className="agent-ledger-link"
          onClick={onLedger}
          aria-label={`Run ledger, ${state.agentRuns.length} ${state.agentRuns.length === 1 ? 'run' : 'runs'}`}
        >
          {state.agentRuns.length} {state.agentRuns.length === 1 ? 'run' : 'runs'}{' '}
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </header>

      <section className="research-scope-panel" aria-label="Search scope">
        <div className="research-scope-switch">
          <button
            type="button"
            className={scope === 'case' ? 'is-active' : ''}
            aria-pressed={scope === 'case'}
            onClick={() => setScope('case')}
            disabled={researchBusy}
          >
            <FileSearch size={15} aria-hidden="true" />
            <span>
              <strong>Case file</strong>
              <small>Preserved sources</small>
            </span>
          </button>
          <button
            type="button"
            className={scope === 'connected' ? 'is-active' : ''}
            aria-pressed={scope === 'connected'}
            onClick={() => setScope('connected')}
            disabled={researchBusy || !connectedReady}
            title={
              connectedReady
                ? 'Read-only browser history, public web, and signed-in surfaces'
                : 'Aside connected research is unavailable'
            }
          >
            <Globe2 size={15} aria-hidden="true" />
            <span>
              <strong>Connected</strong>
              <small>{connectedReady ? 'Aside · read only' : 'Unavailable'}</small>
            </span>
          </button>
        </div>
        <p className={scope === 'connected' ? 'is-connected' : undefined}>
          {scope === 'connected' ? (
            <Globe2 size={14} aria-hidden="true" />
          ) : (
            <FileSearch size={14} aria-hidden="true" />
          )}
          {scope === 'connected'
            ? 'Searches the connected surfaces you allowed and records every source it checked.'
            : 'Searches the case file and records every source it checked.'}
        </p>
      </section>

      <section className="agent-presence-list" aria-label="Seven case agents">
        {agentProfiles.map((agent) => {
          const step = stepByAgent.get(agent.name);
          const working =
            researchBusy &&
            agent.name !== 'INGESTOR' &&
            (progress.length === 0 || progress.some((item) => item.status === 'active'));
          return (
            <button
              key={agent.name}
              type="button"
              onClick={onLedger}
              title={step?.detail ?? `${agent.label} ${agent.verb}`}
            >
              <ThinkingOrb
                state={agent.orb}
                size={20}
                theme="dark"
                paused={!working}
                aria-label={`${agent.label}: ${working ? 'working' : (step?.status ?? 'available')}`}
              />
              <span>
                <strong>{agent.label}</strong>
                <small>{working ? agent.verb : (step?.status ?? agent.verb)}</small>
              </span>
              {step?.status === 'completed' ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <CircleDashed size={14} aria-hidden="true" />
              )}
            </button>
          );
        })}
      </section>

      <div
        className="agent-conversation research-conversation"
        ref={conversationRef}
        aria-live="polite"
      >
        {sessions.length > 1 ? (
          <nav className="research-history" aria-label="Previous research runs">
            {sessions.slice(0, 4).map((item, index) => (
              <button
                key={item.id}
                className={item.id === session?.id ? 'is-active' : ''}
                onClick={() => setSelectedSessionId(item.id)}
              >
                <span>{index === 0 ? 'Latest' : timeLabel(item.completedAt)}</span>
                {item.question}
              </button>
            ))}
          </nav>
        ) : null}

        {!session && !researchBusy ? (
          <motion.section
            className="research-empty-state"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="research-empty-orb">
              <ThinkingOrb state="searching" size={64} theme="dark" paused />
              <i />
              <i />
            </div>
            <span>START WITH A LEAD</span>
            <h2>Ask for one concrete result.</h2>
            <p>
              Name a record, identity, timeline conflict, or claim to verify. THREAD shows
              the sources and the work performed by each agent.
            </p>
          </motion.section>
        ) : null}

        <AnimatePresence initial={false}>
          {researchBusy ? (
            <motion.section
              className="research-live-run"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <article className="research-question-bubble">
                <span>
                  Case run · {scope === 'connected' ? 'connected sweep' : 'case file'}
                </span>
                <p>{question}</p>
              </article>
              <div className="research-live-core">
                <ThinkingOrb
                  state={scope === 'connected' ? 'searching' : 'solving'}
                  size={64}
                  theme="dark"
                  aria-label="Case agents are executing the mission"
                />
                <span>
                  <strong>
                    {scope === 'connected'
                      ? 'Working across connected sources'
                      : 'Executing against the case file'}
                  </strong>
                  <small>Only real completed stages are marked done.</small>
                </span>
              </div>
              <ol className="research-progress-list">
                {(progress.length > 0
                  ? progress
                  : [
                      {
                        id: 'context' as const,
                        label: 'Opening the case investigation',
                        detail: 'Waiting for the first persisted runtime event.',
                        status: 'active' as const,
                      },
                    ]
                ).map((item) => (
                  <li key={item.id} className={`is-${item.status}`}>
                    {item.status === 'completed' ? (
                      <Check size={14} aria-hidden="true" />
                    ) : (
                      <LoaderCircle className="spin" size={14} aria-hidden="true" />
                    )}
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </span>
                  </li>
                ))}
              </ol>
            </motion.section>
          ) : null}

          {session && !researchBusy ? (
            <motion.section
              key={session.id}
              className="research-result-thread"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <article className="research-question-bubble">
                <span>
                  Case run ·{' '}
                  {session.scope === 'connected' ? 'connected sweep' : 'case file'} ·{' '}
                  {timeLabel(session.completedAt)}
                </span>
                <p>{session.question}</p>
              </article>

              {sessionPacket ? (
                <section
                  className="research-rag-trace"
                  aria-label="Evidence retrieval trace"
                >
                  <Database size={16} aria-hidden="true" />
                  <span>
                    <strong>Evidence retrieved</strong>
                    <small>
                      {sessionPacket.retrievalMethod === 'atlas-rank-fusion'
                        ? 'MongoDB hybrid search'
                        : 'bounded local fallback'}
                    </small>
                  </span>
                  <div>
                    <b>{sessionPacket.retrievalHits.length}</b> hits
                    <i>{sessionPacket.exactMatchIds.length} text</i>
                    <i>{sessionPacket.semanticMatchIds.length} semantic</i>
                    <i>{sessionPacket.graphNeighborIds.length} linked</i>
                  </div>
                </section>
              ) : null}

              {sessionMission ? (
                <section className={`mission-plan-card is-${sessionMission.status}`}>
                  <header>
                    <span>
                      <strong>{sessionMission.status.replaceAll('-', ' ')}</strong>
                      <small>{sessionMission.id}</small>
                    </span>
                    <b>
                      {
                        sessionMission.steps.filter((step) => step.status === 'completed')
                          .length
                      }
                      /
                      {
                        sessionMission.steps.filter((step) => step.status !== 'skipped')
                          .length
                      }
                    </b>
                  </header>
                  <ol>
                    {sessionMission.steps
                      .filter((step) => step.status !== 'skipped')
                      .map((step) => (
                        <li key={step.id} className={`is-${step.status}`}>
                          {step.status === 'completed' ? (
                            <Check size={13} aria-hidden="true" />
                          ) : step.status === 'failed' ? (
                            <TriangleAlert size={13} aria-hidden="true" />
                          ) : (
                            <CircleDashed size={13} aria-hidden="true" />
                          )}
                          <span>
                            <strong>{step.label}</strong>
                            <small>{step.detail}</small>
                          </span>
                        </li>
                      ))}
                  </ol>
                  {sessionMission.reviewReason ? (
                    <p>
                      <ShieldAlert size={13} aria-hidden="true" />{' '}
                      {sessionMission.reviewReason}
                    </p>
                  ) : null}
                </section>
              ) : null}

              <article className="research-answer-card">
                <header>
                  <div>
                    <ThinkingOrb
                      state={session.scope === 'connected' ? 'searching' : 'solving'}
                      size={20}
                      theme="dark"
                      paused
                    />
                    <span>
                      <strong>Investigator</strong>
                      <small>{session.provider} · source-traced</small>
                    </span>
                  </div>
                  <b className={`research-confidence is-${session.answerStatus}`}>
                    {percentage(session.confidence)}
                    <small>{session.answerStatus.replaceAll('-', ' ')}</small>
                  </b>
                </header>
                <p>{session.answer}</p>
                {session.scope === 'connected' ? (
                  <aside>
                    <ShieldCheck size={14} aria-hidden="true" /> Connected results are
                    leads. Preserve a source before it changes the board.
                  </aside>
                ) : null}
              </article>

              {session.corrections.length > 0 ? (
                <section className="research-section research-corrections">
                  <header>
                    <TriangleAlert size={16} aria-hidden="true" />
                    <span>
                      <strong>Corrections first</strong>
                      <small>Earlier state changed under new evidence</small>
                    </span>
                  </header>
                  {session.corrections.map((correction) => (
                    <article key={correction.id}>
                      <del>{correction.prior}</del>
                      <p>{correction.corrected}</p>
                      <small>{correction.reason}</small>
                    </article>
                  ))}
                </section>
              ) : null}

              <section className="research-section research-findings">
                <header>
                  <Sparkles size={16} aria-hidden="true" />
                  <span>
                    <strong>What survived</strong>
                    <small>{session.findings.length} traceable findings</small>
                  </span>
                </header>
                <div>
                  {session.findings.map((finding) => (
                    <article key={finding.id} className={`is-${finding.status}`}>
                      <span>
                        {finding.status.replaceAll('-', ' ')} ·{' '}
                        {percentage(finding.confidence)}
                      </span>
                      <h3>{finding.label}</h3>
                      <p>{finding.detail}</p>
                      {finding.sourceIds.length > 0 ? (
                        <div className="research-source-ids">
                          {finding.sourceIds.slice(0, 6).map((id) =>
                            inspectableIds.has(id) ? (
                              <button key={id} onClick={() => onInspect(id)}>
                                {id} <ChevronRight size={12} aria-hidden="true" />
                              </button>
                            ) : (
                              <span key={id}>{id}</span>
                            ),
                          )}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>

              <section className="research-section research-surface-trail">
                <header>
                  <Radar size={16} aria-hidden="true" />
                  <span>
                    <strong>Source trail</strong>
                    <small>Found, empty, and unavailable</small>
                  </span>
                </header>
                <div>
                  {session.surfaceChecks.map((surface) => {
                    const Icon = surfaceIcon(surface.surface);
                    return (
                      <article key={surface.id} className={`is-${surface.status}`}>
                        <Icon size={15} aria-hidden="true" />
                        <span>
                          <strong>{surface.label}</strong>
                          <small>{surface.detail}</small>
                        </span>
                        {surface.sourceId && inspectableIds.has(surface.sourceId) ? (
                          <button
                            onClick={() => onInspect(surface.sourceId!)}
                            aria-label={`Inspect ${surface.label} source`}
                          >
                            <ChevronRight size={14} aria-hidden="true" />
                          </button>
                        ) : isHttpLocator(surface.locator) ? (
                          <a
                            href={surface.locator}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open ${surface.label} locator`}
                          >
                            <ExternalLink size={13} aria-hidden="true" />
                          </a>
                        ) : (
                          <i>{surface.status.replaceAll('-', ' ')}</i>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>

              <section className="research-section research-negative-space">
                <header>
                  <CircleSlash2 size={16} aria-hidden="true" />
                  <span>
                    <strong>Checked, not established</strong>
                    <small>Checks that did not close the question</small>
                  </span>
                </header>
                <ul>
                  {session.negativeFindings.map((finding) => (
                    <li key={finding.id}>
                      <strong>{finding.label}</strong>
                      <span>{finding.detail}</span>
                    </li>
                  ))}
                </ul>
              </section>

              {session.nextQuestions.length > 0 ? (
                <section className="research-next-questions">
                  <span>Next checks</span>
                  {session.nextQuestions.slice(0, 3).map((next) => (
                    <button key={next} onClick={() => askNext(next)}>
                      {next} <ChevronRight size={14} aria-hidden="true" />
                    </button>
                  ))}
                </section>
              ) : null}

              <details className="research-limitations">
                <summary>Boundaries & limitations</summary>
                <ul>
                  {session.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
              </details>

              <button onClick={onLedger} className="research-provenance-button">
                <Activity size={14} aria-hidden="true" />
                <span>
                  <strong>{session.packetId}</strong>
                  <small>
                    {sessionRun?.checkpointId
                      ? `checkpoint ${sessionRun.checkpointId}`
                      : 'local run ledger'}
                  </small>
                </span>
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            </motion.section>
          ) : null}
        </AnimatePresence>

        {auditSteps.length > 0 && !session && !researchBusy ? (
          <ol className="agent-audit-inline">
            {auditSteps.slice(-3).map((step, index) => (
              <li key={`${index}-${step}`}>
                <Check size={13} aria-hidden="true" /> {step}
              </li>
            ))}
          </ol>
        ) : null}
      </div>

      <section className="agent-composer-zone research-composer-zone">
        {error ? (
          <p className="agent-inline-error" role="alert">
            <ShieldAlert size={15} aria-hidden="true" /> {error}
          </p>
        ) : null}
        <div className="research-suggestions" aria-label="Suggested questions">
          {suggestedObjectives.map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => askNext(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>
        <BorderBeam
          className="integrated-agent-beam"
          size="pulse-outside"
          colorVariant={scope === 'connected' ? 'ocean' : 'mono'}
          theme="dark"
          strength={researchBusy ? 0.92 : 0.5}
          active
        >
          <form
            className="agent-integrated-composer"
            onSubmit={(event) => void submit(event)}
          >
            <div className="research-composer-label">
              <label htmlFor="integrated-agent-question">Ask THREAD</label>
              <span>
                {scope === 'connected' ? <Globe2 size={12} /> : <FileSearch size={12} />}
                {scope === 'connected' ? 'connected · read only' : 'case file'}
              </span>
            </div>
            <textarea
              id="integrated-agent-question"
              aria-label="Ask THREAD"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={3}
              minLength={8}
              maxLength={500}
              disabled={researchBusy}
              placeholder="Ask about a person, timestamp, source, contradiction, or missing record."
            />
            <div>
              <span>
                <MessageCircleMore size={14} aria-hidden="true" />
                {scope === 'connected'
                  ? 'Connected sources used only when the mission needs them'
                  : 'Every action returns its source trail'}
              </span>
              <button
                className="agent-voice-button"
                type="button"
                onClick={onInterview}
                disabled={!voiceReady || researchBusy}
                aria-label="Interview witness"
              >
                <AudioLines size={17} aria-hidden="true" />
              </button>
              <button
                className="agent-send-button"
                disabled={
                  researchBusy ||
                  question.trim().length < 8 ||
                  (scope === 'connected' && !connectedReady)
                }
                aria-label="Send to THREAD"
              >
                {researchBusy ? (
                  <LoaderCircle className="spin" size={18} aria-hidden="true" />
                ) : (
                  <Send size={18} aria-hidden="true" />
                )}
              </button>
            </div>
          </form>
        </BorderBeam>
      </section>
    </aside>
  );
}
