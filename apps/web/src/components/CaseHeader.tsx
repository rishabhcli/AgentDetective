import type { CaseState, HealthStatus } from '@thread/domain';
import { BrandMark } from './BrandMark.js';
import { useRef } from 'react';
import {
  Activity,
  ChevronDown,
  GitCompareArrows,
  ImagePlus,
  ListChecks,
  Paperclip,
  Scale,
  Waypoints,
} from 'lucide-react';

interface CaseHeaderProps {
  state: CaseState;
  health: HealthStatus | null;
  busyAction: string | null;
  counterEvidencePresent: boolean;
  onUpload: () => void;
  onCounterEvidence: () => void;
  onChanges: () => void;
  onStatus: () => void;
  onHome?: () => void;
  onReview?: () => void;
  onScenarios?: () => void;
  onDeductions?: () => void;
}

export function CaseHeader({
  state,
  health,
  busyAction,
  counterEvidencePresent,
  onUpload,
  onCounterEvidence,
  onChanges,
  onStatus,
  onHome,
  onReview,
  onScenarios,
  onDeductions,
}: CaseHeaderProps) {
  const toolsRef = useRef<HTMLDetailsElement>(null);
  const runTool = (action?: () => void) => {
    const activeElement = document.activeElement;
    const menuTriggered = Boolean(
      activeElement && toolsRef.current?.contains(activeElement),
    );
    toolsRef.current?.removeAttribute('open');
    if (menuTriggered) {
      toolsRef.current?.querySelector('summary')?.focus();
    }
    action?.();
  };
  const engineState = health?.ok
    ? health.storageMode === 'mongodb'
      ? 'Atlas ready'
      : 'Fallback ready'
    : 'Checking runtime';
  const reviewAvailable =
    health?.integrations.some(
      (integration) => integration.id === 'openrouter' && integration.active,
    ) ?? false;

  return (
    <header className="case-header">
      <button
        className="brand-lockup"
        aria-label="Back to THREAD home"
        onClick={() => runTool(onHome)}
      >
        <BrandMark />
        <div>
          <strong>THREAD</strong>
          <span>Evidence, made inspectable</span>
        </div>
      </button>

      <div className="case-identity">
        <div className="case-meta-row">
          <span className="kicker">
            {state.metadata.reference} · REV{' '}
            {String(state.metadata.revision).padStart(2, '0')}
          </span>
          {state.metadata.synthetic ? (
            <span className="synthetic-tag">DEMO CASE</span>
          ) : null}
        </div>
        <div className="case-title-row">
          <h1>{state.metadata.title}</h1>
        </div>
      </div>

      <div className="header-actions">
        <button
          className="engine-chip"
          onClick={() => runTool(onStatus)}
          aria-label="Open engine status"
        >
          <span className={`status-dot ${health?.ok ? 'is-online' : ''}`} />
          <span>
            <small>RUNTIME</small>
            <strong>{engineState}</strong>
            <em>{health?.engineLabel ?? 'Checking…'}</em>
          </span>
          <Activity size={14} aria-hidden="true" />
        </button>

        <details ref={toolsRef} className="tools-menu">
          <summary>
            Tools <ChevronDown size={14} aria-hidden="true" />
          </summary>
          <div className="tools-popover">
            <div className="tools-popover-head">
              <span>CASE TOOLS</span>
              <small>Use when the current question needs more than the board.</small>
            </div>
            <button onClick={() => runTool(onDeductions)} aria-label="Deduction">
              <Waypoints size={16} aria-hidden="true" />
              <span>
                <strong>Deduction chains</strong>
                <small>Inspect each reasoning leap</small>
              </span>
            </button>
            <button onClick={() => runTool(onScenarios)} aria-label="Demo scenarios">
              <ListChecks size={16} aria-hidden="true" />
              <span>
                <strong>Guided scenarios</strong>
                <small>Run the real engine step by step</small>
              </span>
            </button>
            <button
              onClick={() => runTool(onReview)}
              aria-label="Adversarial review"
              disabled={!reviewAvailable}
            >
              <Scale size={16} aria-hidden="true" />
              <span>
                <strong>Adversarial review</strong>
                <small>
                  {reviewAvailable
                    ? 'Compare two model families'
                    : 'OpenRouter unavailable'}
                </small>
              </span>
            </button>
            <button
              className="tools-counter-evidence"
              onClick={() => runTool(onCounterEvidence)}
              disabled={counterEvidencePresent || busyAction === 'counter-evidence'}
              aria-label={
                counterEvidencePresent
                  ? 'Evidence 143 already recorded'
                  : 'Introduce Evidence 143'
              }
            >
              <ImagePlus size={16} aria-hidden="true" />
              <span>
                <strong>
                  {counterEvidencePresent
                    ? 'Evidence 143 recorded'
                    : busyAction === 'counter-evidence'
                      ? 'Tracing impact…'
                      : 'Introduce Evidence 143'}
                </strong>
                <small>Run the counter-evidence cascade</small>
              </span>
            </button>
          </div>
        </details>

        <button
          className="icon-text-button add-evidence-button"
          onClick={() => runTool(onUpload)}
        >
          <Paperclip size={15} aria-hidden="true" />
          <span>Add evidence</span>
        </button>
        <button
          className="button button-primary change-button"
          onClick={() => runTool(onChanges)}
          aria-label="What changed?"
        >
          <GitCompareArrows size={16} aria-hidden="true" />
          <span>What changed?</span>
          <b>{state.revisions.length}</b>
        </button>
      </div>
    </header>
  );
}
