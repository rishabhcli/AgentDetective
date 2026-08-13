import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { CaseState, Reconstruction } from '@thread/domain';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Crosshair,
  Search,
  ShieldAlert,
} from 'lucide-react';
import type { Selection } from '../model.js';

interface CaseBriefProps {
  state: CaseState;
  busyAction: string | null;
  auditSteps: string[];
  onInvestigate: (anomalyId: string) => void;
  onSelect: (selection: Selection) => void;
}

function reconstructionBeliefId(reconstruction: Reconstruction): string {
  return `B-${reconstruction.id}`;
}

export function CaseBrief({
  state,
  busyAction,
  auditSteps,
  onInvestigate,
  onSelect,
}: CaseBriefProps) {
  const [section, setSection] = useState<'brief' | 'anomalies'>('brief');
  const leading = useMemo(
    () =>
      state.reconstructions.find((reconstruction) => reconstruction.isLeading) ??
      [...state.reconstructions].sort((a, b) => a.rank - b.rank)[0],
    [state.reconstructions],
  );
  const anomalies = useMemo(
    () =>
      [...state.anomalies].sort(
        (a, b) => b.expectedInformationGain - a.expectedInformationGain,
      ),
    [state.anomalies],
  );

  if (!leading) return null;

  return (
    <aside className="case-brief" aria-label="Case reconstruction and anomaly queue">
      <div className="brief-tabs" role="tablist" aria-label="Case side panel">
        <button
          role="tab"
          aria-selected={section === 'brief'}
          className={section === 'brief' ? 'is-active' : ''}
          onClick={() => setSection('brief')}
        >
          Reconstruction
        </button>
        <button
          role="tab"
          aria-selected={section === 'anomalies'}
          className={section === 'anomalies' ? 'is-active' : ''}
          onClick={() => setSection('anomalies')}
        >
          Anomalies
          <span>{state.anomalies.filter((item) => item.status === 'open').length}</span>
        </button>
      </div>

      {section === 'brief' ? (
        <div className="brief-scroll">
          <section className="leading-reconstruction">
            <div className="dossier-kicker">
              <span>CASE RECONSTRUCTION</span>
              <span>REV {String(state.metadata.revision).padStart(2, '0')}</span>
            </div>
            <div className="coverage-head">
              <div
                className="coverage-ring"
                style={
                  {
                    '--coverage': `${leading.coveragePercent * 3.6}deg`,
                  } as React.CSSProperties
                }
                aria-label={`${leading.coveragePercent} percent case coverage`}
              >
                <strong>{leading.coveragePercent}</strong>
                <small>% COVERAGE</small>
              </div>
              <div>
                <span className="status-label leading">{leading.eyebrow}</span>
                <h2>{leading.title}</h2>
                <p>{leading.summary}</p>
              </div>
            </div>
            <div className="coverage-breakdown" aria-label="Case coverage breakdown">
              <CoverageRow
                label="Observed directly"
                value={leading.coverageBreakdown.observedDirectly}
                tone="direct"
              />
              <CoverageRow
                label="Multi-source"
                value={leading.coverageBreakdown.multiSourceSupported}
                tone="multi"
              />
              <CoverageRow
                label="Inferred"
                value={leading.coverageBreakdown.inferred}
                tone="inferred"
              />
              <CoverageRow
                label="Unexplained"
                value={leading.coverageBreakdown.unexplained}
                tone="unknown"
              />
            </div>
            <div className="reconstruction-metrics">
              <span>
                <strong>{leading.explainedPoints}</strong>
                <small>weighted points explained</small>
              </span>
              <span>
                <strong>{leading.contradictions}</strong>
                <small>contradictions</small>
              </span>
              <span>
                <strong>{leading.assumptions}</strong>
                <small>assumptions</small>
              </span>
            </div>
          </section>

          <section className="narrative-strip">
            <div className="section-heading">
              <span>RECONSTRUCTION NARRATIVE</span>
              <small>Every sentence carries a support label</small>
            </div>
            <ol>
              {leading.statements.map((statement) => (
                <li key={statement.id}>
                  <time>{statement.timeLabel}</time>
                  <button
                    className={`statement-status status-${statement.status.toLowerCase()}`}
                    onClick={() => {
                      const source = statement.sourceIds[0];
                      if (!source) return;
                      if (state.claims.some((item) => item.id === source))
                        onSelect({ type: 'claim', id: source });
                      else if (state.observations.some((item) => item.id === source))
                        onSelect({ type: 'observation', id: source });
                      else if (state.assumptions.some((item) => item.id === source))
                        onSelect({ type: 'assumption', id: source });
                    }}
                  >
                    {statement.status.replaceAll('_', ' ')}
                  </button>
                  <p>{statement.text}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="comparison-section">
            <div className="section-heading">
              <span>COMPETING ACCOUNTS</span>
              <small>ACH comparison</small>
            </div>
            <div className="comparison-grid">
              {[...state.reconstructions]
                .sort((a, b) => a.rank - b.rank)
                .map((reconstruction) => (
                  <button
                    key={reconstruction.id}
                    className={reconstruction.isLeading ? 'is-leading' : ''}
                    onClick={() =>
                      onSelect({
                        type: 'belief',
                        id: reconstructionBeliefId(reconstruction),
                      })
                    }
                  >
                    <span>
                      {reconstruction.isLeading ? (
                        <Check size={12} aria-hidden="true" />
                      ) : null}
                      {reconstruction.id}
                    </span>
                    <strong>{reconstruction.coveragePercent}%</strong>
                    <small>{reconstruction.title}</small>
                    <i>
                      <b style={{ width: `${reconstruction.coveragePercent}%` }} />
                    </i>
                  </button>
                ))}
            </div>
            <div className="distinguish-callout">
              <Crosshair size={17} aria-hidden="true" />
              <span>
                <small>WHAT WOULD DISTINGUISH THEM?</small>
                <strong>Establish the identity of the 21:09 east-door entrant.</strong>
              </span>
            </div>
          </section>
        </div>
      ) : (
        <div className="brief-scroll anomaly-panel">
          <header className="anomaly-intro">
            <span className="kicker">VALUE OF INFORMATION</span>
            <h2>Anomaly queue</h2>
            <p>
              Ordered by expected ability to separate the competing reconstructions—not by
              drama.
            </p>
          </header>
          <div className="anomaly-list">
            {anomalies.map((anomaly, index) => {
              const busy = busyAction === `investigate:${anomaly.id}`;
              return (
                <article
                  key={anomaly.id}
                  className={`anomaly-card status-${anomaly.status}`}
                >
                  <div className="anomaly-rank">{String(index + 1).padStart(2, '0')}</div>
                  <div className="anomaly-copy">
                    <span>
                      {anomaly.category.toUpperCase()} · EIG{' '}
                      {Math.round(anomaly.expectedInformationGain * 100)}
                    </span>
                    <h3>{anomaly.question}</h3>
                    <p>{anomaly.lastResult ?? anomaly.detail}</p>
                    <div className="anomaly-related">
                      {anomaly.relatedIds.map((id) => (
                        <button
                          key={id}
                          onClick={() => {
                            if (state.unresolvedReferences.some((item) => item.id === id))
                              onSelect({ type: 'reference', id });
                            else if (state.assumptions.some((item) => item.id === id))
                              onSelect({ type: 'assumption', id });
                            else if (state.evidence.some((item) => item.id === id))
                              onSelect({ type: 'evidence', id });
                            else if (state.entities.some((item) => item.id === id))
                              onSelect({ type: 'entity', id });
                          }}
                        >
                          {id}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    className="investigate-button"
                    disabled={anomaly.status !== 'open' || busyAction !== null}
                    onClick={() => onInvestigate(anomaly.id)}
                  >
                    {busy ? (
                      <>
                        <Search className="spin" size={14} aria-hidden="true" />
                        Running
                      </>
                    ) : anomaly.status === 'open' ? (
                      <>
                        Investigate <ArrowRight size={14} aria-hidden="true" />
                      </>
                    ) : (
                      <>
                        {anomaly.status} <Check size={14} aria-hidden="true" />
                      </>
                    )}
                  </button>
                </article>
              );
            })}
          </div>
          <AnimatePresence>
            {auditSteps.length > 0 ? (
              <motion.section
                className="agent-audit"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="agent-audit-head">
                  <span>
                    <ShieldAlert size={14} aria-hidden="true" /> LAST EXECUTED TRACE
                  </span>
                  <ChevronDown size={14} aria-hidden="true" />
                </div>
                <ol>
                  {auditSteps.map((step, index) => (
                    <li key={`${index}-${step}`}>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      {step}
                    </li>
                  ))}
                </ol>
              </motion.section>
            ) : null}
          </AnimatePresence>
        </div>
      )}
    </aside>
  );
}

function CoverageRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'direct' | 'multi' | 'inferred' | 'unknown';
}) {
  return (
    <div className={`coverage-row coverage-${tone}`}>
      <span>{label}</span>
      <i>
        <b style={{ width: `${value}%` }} />
      </i>
      <strong>{value}%</strong>
    </div>
  );
}
