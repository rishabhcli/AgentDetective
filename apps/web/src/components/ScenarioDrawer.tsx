import { motion } from 'motion/react';
import type { CaseState, HealthStatus } from '@thread/domain';
import { ArrowRight, Check, CircleOff, ListChecks, Play, X } from 'lucide-react';
import { scenarioAvailability, scenarios, type Scenario } from '../scenarios.js';
import { useDialogDismiss } from '../useDialogDismiss.js';

interface ScenarioDrawerProps {
  state: CaseState;
  health: HealthStatus | null;
  busyAction: string | null;
  auditSteps: string[];
  onRun: (scenario: Scenario) => void;
  onClose: () => void;
}

export function ScenarioDrawer({
  state,
  health,
  busyAction,
  auditSteps,
  onRun,
  onClose,
}: ScenarioDrawerProps) {
  useDialogDismiss(onClose);
  return (
    <>
      <motion.button
        className="drawer-scrim"
        aria-label="Close demo scenarios"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.aside
        className="scenario-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Demo scenarios"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
      >
        <header className="drawer-header">
          <div>
            <span className="kicker">GUIDED DEMONSTRATIONS</span>
            <h2>Demo scenarios</h2>
            <p>
              Each scenario runs the real engine. Nothing here is a recording or a scripted
              animation.
            </p>
          </div>
          <button aria-label="Close demo scenarios" onClick={onClose} autoFocus>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="scenario-body">
          {scenarios.map((scenario) => {
            const availability = scenarioAvailability(scenario, state, health);
            const running = busyAction === `scenario:${scenario.id}`;
            const disabled = availability.state !== 'ready' || busyAction !== null;
            return (
              <article
                key={scenario.id}
                className={`scenario-card is-${availability.state}`}
                aria-label={scenario.title}
              >
                <div className="scenario-index">{scenario.index}</div>
                <div className="scenario-copy">
                  <span className="scenario-question">{scenario.question}</span>
                  <h3>{scenario.title}</h3>
                  <p className="scenario-proves">{scenario.proves}</p>

                  <ol className="scenario-steps">
                    {scenario.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>

                  <div className="scenario-runtime">
                    <ListChecks size={12} aria-hidden="true" />
                    <span>{scenario.runtime}</span>
                  </div>

                  <div className={`scenario-availability is-${availability.state}`}>
                    {availability.state === 'ready' ? (
                      <Check size={12} aria-hidden="true" />
                    ) : (
                      <CircleOff size={12} aria-hidden="true" />
                    )}
                    <span>{availability.detail}</span>
                  </div>
                </div>

                <button
                  className="scenario-run"
                  disabled={disabled}
                  onClick={() => onRun(scenario)}
                >
                  {running ? (
                    <>
                      <Play className="spin" size={13} aria-hidden="true" />
                      Running
                    </>
                  ) : (
                    <>
                      {scenario.cta}
                      <ArrowRight size={13} aria-hidden="true" />
                    </>
                  )}
                </button>
              </article>
            );
          })}

          {auditSteps.length > 0 ? (
            <section className="scenario-audit" aria-label="Last executed scenario trace">
              <div className="section-heading">
                <span>LAST EXECUTED TRACE</span>
                <small>Reported by the API, not by this panel</small>
              </div>
              <ol>
                {auditSteps.map((step, index) => (
                  <li key={`${index}-${step}`}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    {step}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
        <footer className="scenario-footer">
          EVERY SCENARIO EXECUTES THE REAL ENGINE · NO REPLAYS · NO SCRIPTED TIMINGS
        </footer>
      </motion.aside>
    </>
  );
}
