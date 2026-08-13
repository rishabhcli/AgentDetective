import { useState } from 'react';
import { motion } from 'motion/react';
import type { CaseRevision, CaseState } from '@thread/domain';
import {
  ArrowDown,
  ArrowDownRight,
  ArrowUpRight,
  GitCompareArrows,
  Link2,
  Minus,
  Plus,
  X,
} from 'lucide-react';
import type { Selection } from '../model.js';
import { useDialogDismiss } from '../useDialogDismiss.js';

interface ChangeDrawerProps {
  state: CaseState;
  onSelect: (selection: Selection) => void;
  onClose: () => void;
}

function directionIcon(direction: CaseRevision['changes'][number]['direction']) {
  if (direction === 'raised') return <ArrowUpRight size={15} aria-hidden="true" />;
  if (direction === 'lowered' || direction === 'invalidated')
    return <ArrowDownRight size={15} aria-hidden="true" />;
  if (direction === 'added') return <Plus size={15} aria-hidden="true" />;
  return <Minus size={15} aria-hidden="true" />;
}

export function ChangeDrawer({ state, onSelect, onClose }: ChangeDrawerProps) {
  useDialogDismiss(onClose);
  const [revisionId, setRevisionId] = useState(state.revisions[0]?.id ?? '');
  const revision =
    state.revisions.find((item) => item.id === revisionId) ?? state.revisions[0];
  return (
    <>
      <motion.button
        className="drawer-scrim"
        aria-label="Close change history"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.aside
        className="change-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="What changed"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      >
        <header className="change-header">
          <div>
            <span className="kicker">CASE STATE / REVISION DIFF</span>
            <h2>What changed?</h2>
            <p>A causal trace across evidence, assumptions, events, and beliefs.</p>
          </div>
          <button aria-label="Close change history" onClick={onClose} autoFocus>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="change-layout">
          <nav className="revision-list" aria-label="Case revisions">
            <span>REVISION HISTORY</span>
            {state.revisions.map((item) => (
              <button
                key={item.id}
                className={item.id === revision?.id ? 'is-active' : ''}
                onClick={() => setRevisionId(item.id)}
              >
                <small>
                  REV {String(item.sequence).padStart(2, '0')} ·{' '}
                  {new Date(item.createdAt).toLocaleDateString()}
                </small>
                <strong>{item.title}</strong>
                <span>{item.changes.length} changes</span>
              </button>
            ))}
          </nav>
          {revision ? (
            <div className="revision-detail">
              <section className="revision-lead">
                <div>
                  <GitCompareArrows size={20} aria-hidden="true" />
                  <span>REV {String(revision.sequence).padStart(2, '0')}</span>
                </div>
                <h3>{revision.title}</h3>
                <p>{revision.summary}</p>
                <time>{new Date(revision.createdAt).toLocaleString()}</time>
              </section>
              <section className="change-list-section">
                <span className="inspector-section-label">MATERIAL CHANGES</span>
                <div className="change-list">
                  {revision.changes.map((change) => (
                    <article key={change.id} className={`change-${change.direction}`}>
                      <div>{directionIcon(change.direction)}</div>
                      <span>
                        <small>
                          {change.kind.toUpperCase()} · {change.subjectId}
                        </small>
                        <strong>{change.label}</strong>
                      </span>
                      <div className="before-after">
                        <span>{change.before ?? 'NOT PRESENT'}</span>
                        <ArrowDown size={12} aria-hidden="true" />
                        <strong>{change.after ?? 'REMOVED'}</strong>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
              <section className="causal-trace">
                <span className="inspector-section-label">WHY THE MODEL MOVED</span>
                <ol>
                  {revision.trace.map((step, index) => (
                    <li key={step.id}>
                      <span className={`trace-kind trace-${step.kind}`}>
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div>
                        <small>{step.kind.toUpperCase()}</small>
                        <strong>{step.label}</strong>
                        <p>{step.relation}</p>
                      </div>
                      {index < revision.trace.length - 1 ? <i aria-hidden="true" /> : null}
                    </li>
                  ))}
                </ol>
              </section>
              {revision.triggerEvidenceId ? (
                <button
                  className="open-trigger-button"
                  onClick={() =>
                    onSelect({ type: 'evidence', id: revision.triggerEvidenceId! })
                  }
                >
                  <Link2 size={14} aria-hidden="true" />
                  Inspect trigger {revision.triggerEvidenceId}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <footer className="drawer-footer">
          ORIGINAL REVISIONS ARE PRESERVED · NO HISTORY REWRITE
        </footer>
      </motion.aside>
    </>
  );
}
