import { motion } from 'motion/react';
import type { HealthStatus } from '@thread/domain';
import { CheckCircle2, CircleOff, Database, RefreshCw, ServerCog, X } from 'lucide-react';
import { useDialogDismiss } from '../useDialogDismiss.js';

interface StatusDrawerProps {
  health: HealthStatus;
  busy: boolean;
  onVerify: () => void;
  onClose: () => void;
}

export function StatusDrawer({ health, busy, onVerify, onClose }: StatusDrawerProps) {
  useDialogDismiss(onClose);
  return (
    <>
      <motion.button
        className="drawer-scrim"
        aria-label="Close engine status"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.aside
        className="status-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Engine status"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
      >
        <header className="drawer-header">
          <div>
            <span className="kicker">RUNTIME TRUTH</span>
            <h2>Engine status</h2>
            <p>Configured, active, and unavailable are deliberately different states.</p>
          </div>
          <button aria-label="Close engine status" onClick={onClose} autoFocus>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="status-body">
          <section className="active-engine-card">
            {health.storageMode === 'mongodb' ? (
              <Database size={24} />
            ) : (
              <ServerCog size={24} />
            )}
            <span>
              <small>ACTIVE MODE</small>
              <strong>{health.engineLabel}</strong>
              <p>
                {health.storageMode === 'mongodb'
                  ? 'Normalized case collections are persisted in the configured database.'
                  : 'Case mutations are persisted atomically to the local JSON store.'}
              </p>
            </span>
          </section>
          <div className="integration-list">
            {health.integrations.map((integration) => (
              <article
                key={integration.id}
                className={integration.active ? 'is-active' : ''}
              >
                <div>
                  {integration.active ? (
                    <CheckCircle2 size={17} aria-hidden="true" />
                  ) : (
                    <CircleOff size={17} aria-hidden="true" />
                  )}
                </div>
                <span>
                  <small>
                    {integration.active
                      ? 'ACTIVE'
                      : integration.configured
                        ? 'CONFIGURED / INACTIVE'
                        : 'NOT CONFIGURED'}
                  </small>
                  <strong>{integration.label}</strong>
                  <p>{integration.detail}</p>
                </span>
              </article>
            ))}
          </div>
          <section className="capability-status-grid">
            <span>LOCAL CAPABILITY PROBES</span>
            <div>
              {(health.capabilities ?? []).map((capability) => (
                <article
                  key={capability.id}
                  className={capability.active ? 'is-active' : ''}
                >
                  <i />
                  <strong>{capability.label}</strong>
                  <small>{capability.detail}</small>
                </article>
              ))}
            </div>
          </section>
          <section className="truth-boundary status-truth">
            <CircleOff size={18} aria-hidden="true" />
            <div>
              <strong>No simulated integrations</strong>
              <p>
                This panel reports runtime state from the API. An absent provider does not
                produce fake transcripts, embeddings, model calls, or connection indicators.
              </p>
            </div>
          </section>
          <button className="button status-verify" onClick={onVerify} disabled={busy}>
            <RefreshCw className={busy ? 'spin' : ''} size={14} aria-hidden="true" />
            {busy ? 'Verifying live providers…' : 'Re-run live verification'}
          </button>
        </div>
        <footer className="drawer-footer">
          HEALTH ROUTE /api/health · LIVE RUNTIME STATE
        </footer>
      </motion.aside>
    </>
  );
}
