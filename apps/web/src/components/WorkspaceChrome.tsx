import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  FileClock,
  FolderPlus,
  MoreHorizontal,
  Repeat,
  RotateCcw,
  Route,
  Scale,
  SearchCode,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  hackathonCaseId,
  sampleCaseId,
  type CaseMetadata,
  type CaseState,
  type HealthStatus,
} from '@thread/domain';
import { BrandMark } from './BrandMark.js';

interface WorkspaceChromeProps {
  state: CaseState;
  health: HealthStatus | null;
  busyAction: string | null;
  counterEvidencePresent: boolean;
  onHome: () => void;
  onChanges: () => void;
  onStatus: () => void;
  onCounterEvidence: () => void;
  onScenarios: () => void;
  onDeductions: () => void;
  onReset: () => void;
  onNewCase: () => void;
  onRederive: () => void;
  onDeleteCase: () => void;
  cases: CaseMetadata[];
  onChooseCase: (caseId: string) => void;
}

export function WorkspaceChrome({
  state,
  health,
  busyAction,
  counterEvidencePresent,
  onHome,
  onChanges,
  onStatus,
  onCounterEvidence,
  onScenarios,
  onDeductions,
  onReset,
  onNewCase,
  onRederive,
  onDeleteCase,
  cases,
  onChooseCase,
}: WorkspaceChromeProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const ready = Boolean(health?.ok);
  // Only the two bundled fixtures can be restored; anything else is the
  // investigator's own work and is deleted rather than reset.
  const bundled =
    state.metadata.id === sampleCaseId || state.metadata.id === hackathonCaseId;
  function choose(action: () => void) {
    setMenuOpen(false);
    moreButtonRef.current?.focus();
    action();
  }
  return (
    <>
      <nav className="workspace-orb" aria-label="Case controls">
        <button
          className="workspace-home"
          onClick={onHome}
          aria-label="Back to THREAD home"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          <BrandMark />
        </button>
        <label className="workspace-case-name">
          <span>{state.metadata.reference}</span>
          <strong>{state.metadata.title}</strong>
          <select
            aria-label="Switch case"
            value={state.metadata.id}
            onChange={(event) => onChooseCase(event.target.value)}
          >
            {cases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
          <ChevronDown className="workspace-case-chevron" size={13} aria-hidden="true" />
        </label>
        <button className="workspace-revision" onClick={onChanges}>
          <FileClock size={14} aria-hidden="true" /> REV{' '}
          {String(state.metadata.revision).padStart(2, '0')}
        </button>
        <button className="workspace-runtime" onClick={onStatus}>
          <i className={ready ? 'is-ready' : ''} />
          <span>{ready ? 'Case engine ready' : 'Checking engine'}</span>
        </button>
        <div className="workspace-menu-wrap">
          <button
            ref={moreButtonRef}
            className="workspace-more"
            aria-label="More case actions"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <MoreHorizontal size={18} aria-hidden="true" />
          </button>
          <AnimatePresence>
            {menuOpen ? (
              <motion.div
                className="workspace-action-menu"
                // Opacity only. A menu that slides or scales while it opens
                // moves its own targets out from under the pointer, which costs
                // a real click as readily as an automated one.
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
              >
                <button onClick={() => choose(onChanges)} aria-label="What changed?">
                  <FileClock size={15} />
                  <span>
                    <strong>What changed?</strong>
                    <small>Trace the current revision</small>
                  </span>
                </button>
                <button onClick={() => choose(onDeductions)} aria-label="Deduction">
                  <SearchCode size={15} />
                  <span>
                    <strong>Deduction chains</strong>
                    <small>Inspect every leap</small>
                  </span>
                </button>
                {state.metadata.synthetic ? (
                  <>
                    <button onClick={() => choose(onScenarios)} aria-label="Demo scenarios">
                      <Route size={15} />
                      <span>
                        <strong>Guided scenarios</strong>
                        <small>Exercise real flows</small>
                      </span>
                    </button>
                    <button
                      onClick={() => choose(onCounterEvidence)}
                      disabled={counterEvidencePresent || busyAction !== null}
                      aria-label={
                        counterEvidencePresent
                          ? 'Evidence 143 already recorded'
                          : 'Introduce Evidence 143'
                      }
                    >
                      {counterEvidencePresent ? <Check size={15} /> : <Scale size={15} />}
                      <span>
                        <strong>
                          {counterEvidencePresent
                            ? 'Evidence 143 recorded'
                            : 'Test cascade'}
                        </strong>
                        <small>Introduce counter-evidence</small>
                      </span>
                    </button>
                  </>
                ) : null}
                <button onClick={() => choose(onStatus)} aria-label="Open engine status">
                  <ShieldCheck size={15} />
                  <span>
                    <strong>Engine status</strong>
                    <small>{health?.engineLabel ?? 'Checking runtime'}</small>
                  </span>
                </button>
                <button onClick={() => choose(onNewCase)} aria-label="Open a new case">
                  <FolderPlus size={15} />
                  <span>
                    <strong>Open a new case</strong>
                    <small>Start from nothing but evidence</small>
                  </span>
                </button>
                <button
                  onClick={() => choose(onRederive)}
                  disabled={busyAction !== null}
                  aria-label="Re-derive the case"
                >
                  <Repeat size={15} />
                  <span>
                    <strong>Re-derive the case</strong>
                    <small>Rebuild what the record supports</small>
                  </span>
                </button>
                {bundled ? (
                  <button
                    className="workspace-reset"
                    onClick={() => choose(onReset)}
                    disabled={busyAction === 'reset'}
                  >
                    <RotateCcw size={15} />
                    <span>
                      <strong>
                        {state.metadata.synthetic ? 'Reset sample' : 'Reset case'}
                      </strong>
                      <small>
                        {state.metadata.synthetic
                          ? 'Restore controlled fixture'
                          : 'Restore the redacted Aside handoff'}
                      </small>
                    </span>
                  </button>
                ) : (
                  <button
                    className="workspace-reset"
                    onClick={() => choose(onDeleteCase)}
                    disabled={busyAction !== null}
                    aria-label="Delete this case"
                  >
                    <Trash2 size={15} />
                    <span>
                      <strong>Delete this case</strong>
                      <small>Removes it and everything derived from it</small>
                    </span>
                  </button>
                )}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </nav>
      {busyAction ? (
        <div className="workspace-transform-pill" role="status">
          <span className="workspace-metal-dot" aria-hidden="true" />
          <strong>Updating the case record</strong>
          <ChevronDown size={13} aria-hidden="true" />
        </div>
      ) : null}
    </>
  );
}
