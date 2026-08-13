import type { CaseState, HealthStatus } from '@thread/domain';
import { motion } from 'motion/react';
import { Activity, Box, Check, CircleDashed, Database, X } from 'lucide-react';
import { useDialogDismiss } from '../useDialogDismiss.js';

interface ObservabilityDrawerProps {
  state: CaseState;
  health: HealthStatus | null;
  onClose: () => void;
}

function clock(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

export function ObservabilityDrawer({ state, health, onClose }: ObservabilityDrawerProps) {
  useDialogDismiss(onClose);
  const latestRun = state.agentRuns[0];
  const latestPacket = state.casePackets[0];
  return (
    <>
      <motion.button
        className="drawer-scrim"
        aria-label="Close run ledger"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.aside
        className="observability-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Run ledger"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 320 }}
      >
        <header className="drawer-header ledger-drawer-header">
          <div>
            <span className="kicker">EXECUTION / NOT NARRATION</span>
            <h2>Run ledger</h2>
            <p>Actual transformations, bounded input, provider, and checkpoint lineage.</p>
          </div>
          <button aria-label="Close run ledger" onClick={onClose} autoFocus>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="observability-body">
          <section className="run-verdict">
            <div>
              <Activity size={18} aria-hidden="true" />
              <span>
                <small>LATEST RUN</small>
                <strong>{latestRun?.id ?? 'No runtime run'}</strong>
              </span>
            </div>
            <p>
              {latestRun?.trigger ??
                'The authored fixture is loaded without a runtime mutation.'}
            </p>
            <dl>
              <div>
                <dt>Status</dt>
                <dd>{latestRun?.status ?? 'fixture'}</dd>
              </div>
              <div>
                <dt>Affected</dt>
                <dd>{latestRun?.affectedIds.length ?? 0} objects</dd>
              </div>
              <div>
                <dt>Checkpoint</dt>
                <dd title={latestRun?.checkpointId ?? ''}>
                  {latestRun?.checkpointId ?? 'none'}
                </dd>
              </div>
              <div>
                <dt>Completed</dt>
                <dd>{latestRun ? clock(latestRun.completedAt) : '—'}</dd>
              </div>
            </dl>
          </section>

          {latestRun ? (
            <section className="agent-transform-ledger">
              <div className="ledger-section-head">
                <span>SUPERSTEP TRACE</span>
                <small>{latestRun.checkpointThreadId ?? 'No Mongo checkpointer'}</small>
              </div>
              <ol>
                {latestRun.steps.map((step, index) => (
                  <li key={step.id} className={`step-${step.status}`}>
                    <span className="step-index">{String(index + 1).padStart(2, '0')}</span>
                    <span className="step-state">
                      {step.status === 'completed' ? (
                        <Check size={12} aria-hidden="true" />
                      ) : (
                        <CircleDashed size={12} aria-hidden="true" />
                      )}
                    </span>
                    <div>
                      <div>
                        <strong>{step.agent}</strong>
                        <em>{step.status}</em>
                      </div>
                      <p>{step.detail}</p>
                      <small>
                        {step.provider.toUpperCase()}
                        {step.model ? ` · ${step.model}` : ''} · {step.inputIds.length} in /{' '}
                        {step.outputIds.length} out · {step.durationMs} ms transform
                      </small>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <section className="packet-ledger">
            <div className="ledger-section-head">
              <span>BOUNDED CASE PACKET</span>
              <small>{latestPacket?.id ?? 'No runtime packet'}</small>
            </div>
            {latestPacket ? (
              <>
                <blockquote>{latestPacket.question}</blockquote>
                <div className="packet-matrix">
                  <span>
                    <b>{latestPacket.exactMatchIds.length}</b> exact
                  </span>
                  <span>
                    <b>{latestPacket.semanticMatchIds.length}</b> semantic
                  </span>
                  <span>
                    <b>{latestPacket.graphNeighborIds.length}</b> neighbors
                  </span>
                  <span>
                    <b>{latestPacket.previousAttemptIds.length}</b> prior attempts
                  </span>
                </div>
                <p>
                  <Box size={12} aria-hidden="true" />{' '}
                  {latestPacket.retrievalMethod.replaceAll('-', ' ')} · graph depth{' '}
                  {latestPacket.strategy.graphDepth} · never the whole case
                </p>
              </>
            ) : (
              <p className="empty-ledger">
                Run an investigation or review to assemble a packet.
              </p>
            )}
          </section>

          <section className="capability-ledger">
            <div className="ledger-section-head">
              <span>RUNTIME CAPABILITIES</span>
              <small>reported by /api/health</small>
            </div>
            <div>
              {(health?.capabilities ?? []).map((capability) => (
                <article key={capability.id} className={capability.active ? 'is-live' : ''}>
                  <Database size={12} aria-hidden="true" />
                  <span>
                    <strong>{capability.label}</strong>
                    <small>{capability.detail}</small>
                  </span>
                  <b>{capability.active ? 'LIVE' : 'OFF'}</b>
                </article>
              ))}
            </div>
          </section>
        </div>
        <footer className="drawer-footer">
          {state.agentRuns.length} RUNS · {state.casePackets.length} PACKETS ·{' '}
          {state.worldMemory.length +
            state.evidenceMemory.length +
            state.beliefMemory.length +
            state.proceduralMemory.length}{' '}
          MEMORY RECORDS
        </footer>
      </motion.aside>
    </>
  );
}
