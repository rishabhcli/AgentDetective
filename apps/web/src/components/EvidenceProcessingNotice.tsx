import { useState, type FormEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { BorderBeam } from 'border-beam';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  FileCheck2,
  FileSearch,
  LoaderCircle,
  ShieldQuestion,
  X,
} from 'lucide-react';
import type { EvidenceClarification, EvidenceIngestionReceipt } from '@thread/domain';

export type EvidenceNoticeState =
  | {
      phase: 'processing';
      title: string;
      fileName: string;
    }
  | {
      phase: 'complete';
      title: string;
      fileName: string;
      receipt: EvidenceIngestionReceipt;
      clarification: EvidenceClarification | null;
    };

interface EvidenceProcessingNoticeProps {
  notice: EvidenceNoticeState;
  onClose: () => void;
  onInspect: (evidenceId: string) => void;
  onChanges: () => void;
  onAnswer: (
    clarificationId: string,
    choiceId: string,
    customAnswer?: string,
  ) => Promise<void>;
}

export function EvidenceProcessingNotice({
  notice,
  onClose,
  onInspect,
  onChanges,
  onAnswer,
}: EvidenceProcessingNoticeProps) {
  const clarification = notice.phase === 'complete' ? notice.clarification : null;
  const reduceMotion = useReducedMotion();
  const [choiceId, setChoiceId] = useState('');
  const [customAnswer, setCustomAnswer] = useState('');
  const [answering, setAnswering] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);

  async function submitAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clarification || !choiceId) {
      setAnswerError('Choose the closest answer.');
      return;
    }
    if (choiceId === 'custom' && customAnswer.trim().length < 3) {
      setAnswerError('Add a short explanation for the custom answer.');
      return;
    }
    setAnswering(true);
    setAnswerError(null);
    try {
      await onAnswer(
        clarification.id,
        choiceId,
        choiceId === 'custom' ? customAnswer.trim() : undefined,
      );
    } catch (cause) {
      setAnswerError(
        cause instanceof Error ? cause.message : 'The clarification was not recorded.',
      );
    } finally {
      setAnswering(false);
    }
  }

  const receipt = notice.phase === 'complete' ? notice.receipt : null;
  const completedTitle =
    receipt?.outcome === 'duplicate'
      ? 'Already preserved'
      : receipt?.extractionStatus === 'requires-adapter'
        ? 'Original preserved'
        : 'Evidence processed';

  return (
    <motion.aside
      className={`evidence-processing-notice is-${notice.phase}`}
      role="region"
      aria-label="Evidence processing notification"
      initial={reduceMotion ? false : { opacity: 0, y: -18, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.98 }}
      transition={{ duration: reduceMotion ? 0 : 0.36, ease: [0.16, 1, 0.3, 1] }}
    >
      <BorderBeam
        className="evidence-notice-beam"
        size="pulse-outside"
        colorVariant={clarification?.status === 'open' ? 'sunset' : 'mono'}
        theme="dark"
        strength={notice.phase === 'processing' ? 0.9 : 0.5}
        active={
          !reduceMotion &&
          (notice.phase === 'processing' || clarification?.status === 'open')
        }
      >
        <div className="evidence-notice-inner">
          <header>
            <span className="evidence-notice-icon" aria-hidden="true">
              {notice.phase === 'processing' ? (
                <LoaderCircle className="spin" size={21} />
              ) : clarification?.status === 'open' ? (
                <ShieldQuestion size={21} />
              ) : (
                <FileCheck2 size={21} />
              )}
            </span>
            <div>
              <span className="evidence-notice-eyebrow">
                {notice.phase === 'processing'
                  ? 'PRESERVE-FIRST INTAKE'
                  : 'INGESTION RECEIPT'}
              </span>
              <h2>
                {notice.phase === 'processing' ? 'Processing evidence' : completedTitle}
              </h2>
              <p>{notice.fileName}</p>
            </div>
            {notice.phase === 'complete' && clarification?.status !== 'open' ? (
              <button onClick={onClose} aria-label="Dismiss evidence notification">
                <X size={18} aria-hidden="true" />
              </button>
            ) : null}
          </header>

          {notice.phase === 'processing' ? (
            <div className="evidence-processing-copy" aria-live="polite">
              <div className="evidence-processing-track">
                <motion.i
                  animate={reduceMotion ? { x: '95%' } : { x: ['-100%', '260%'] }}
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { repeat: Infinity, duration: 1.4, ease: 'easeInOut' }
                  }
                />
              </div>
              <p>
                Hashing the original, preserving its bytes, and running only the readers
                available now. THREAD will not invent missing content.
              </p>
            </div>
          ) : receipt ? (
            <>
              <div className="evidence-receipt-grid" aria-live="polite">
                <span>
                  <strong>{receipt.evidenceId}</strong>
                  Artifact
                </span>
                <span>
                  <strong>{receipt.observationCount}</strong>
                  Observations
                </span>
                <span>
                  <strong>{receipt.claimCount}</strong>
                  Claims
                </span>
                <span>
                  <strong>{receipt.unresolvedReferenceCount}</strong>
                  Unresolved
                </span>
              </div>

              {receipt.extractionStatus === 'requires-adapter' ? (
                <div className="evidence-notice-boundary">
                  <AlertTriangle size={17} aria-hidden="true" />
                  <p>
                    The file format is not currently interpretable. The immutable original
                    is safe and available for a future adapter; the case continued without a
                    fabricated description.
                  </p>
                </div>
              ) : (
                <p className="evidence-notice-summary">
                  <Check size={16} aria-hidden="true" /> {receipt.extractionStatus}
                  {' extraction · '}
                  {receipt.extractor.replaceAll('-', ' ')}
                </p>
              )}

              {receipt.warnings.length > 0 ? (
                <details className="evidence-notice-warnings">
                  <summary>
                    {receipt.warnings.length} processing note
                    {receipt.warnings.length === 1 ? '' : 's'}
                  </summary>
                  <ul>
                    {receipt.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </details>
              ) : null}

              <AnimatePresence initial={false}>
                {clarification?.status === 'open' ? (
                  <motion.form
                    className="evidence-clarification"
                    onSubmit={(event) => void submitAnswer(event)}
                    initial={reduceMotion ? false : { opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <span className="evidence-clarification-kicker">
                      RARE CLARIFICATION · SOURCE ALREADY PRESERVED
                    </span>
                    <h3>{clarification.question}</h3>
                    <p>{clarification.detail}</p>
                    <fieldset>
                      <legend>Choose one answer</legend>
                      {clarification.choices.map((choice) => (
                        <label key={choice.id}>
                          <input
                            type="radio"
                            name="clarification-choice"
                            value={choice.id}
                            checked={choiceId === choice.id}
                            onChange={() => setChoiceId(choice.id)}
                          />
                          <span>
                            <strong>
                              {choice.label}
                              {choice.recommended ? <i>Recommended</i> : null}
                            </strong>
                            <small>{choice.description}</small>
                          </span>
                        </label>
                      ))}
                      {clarification.allowCustomAnswer ? (
                        <label>
                          <input
                            type="radio"
                            name="clarification-choice"
                            value="custom"
                            checked={choiceId === 'custom'}
                            onChange={() => setChoiceId('custom')}
                          />
                          <span>
                            <strong>Something else</strong>
                            <small>Use only when none of the listed choices fits.</small>
                          </span>
                        </label>
                      ) : null}
                    </fieldset>
                    <AnimatePresence>
                      {choiceId === 'custom' ? (
                        <motion.label
                          className="evidence-custom-answer"
                          initial={reduceMotion ? false : { opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                        >
                          <span>Describe the classification context</span>
                          <textarea
                            value={customAnswer}
                            onChange={(event) => setCustomAnswer(event.target.value)}
                            maxLength={500}
                            rows={3}
                            autoFocus
                          />
                        </motion.label>
                      ) : null}
                    </AnimatePresence>
                    {answerError ? (
                      <p className="evidence-answer-error" role="alert">
                        {answerError}
                      </p>
                    ) : null}
                    <button
                      className="evidence-answer-submit"
                      disabled={answering || !choiceId}
                    >
                      {answering ? (
                        <LoaderCircle className="spin" size={17} aria-hidden="true" />
                      ) : (
                        <Check size={17} aria-hidden="true" />
                      )}
                      Record answer and continue
                    </button>
                  </motion.form>
                ) : clarification?.status === 'answered' ? (
                  <motion.div
                    className="evidence-answer-recorded"
                    initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <Check size={17} aria-hidden="true" />
                    <span>
                      <strong>Answer recorded</strong>
                      Source preserved; classification context attached without rewriting
                      it.
                    </span>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              <footer>
                <button onClick={() => onInspect(receipt.evidenceId)}>
                  <FileSearch size={16} aria-hidden="true" /> Inspect source
                </button>
                {receipt.outcome === 'preserved' ? (
                  <button onClick={onChanges}>
                    What changed? <ArrowUpRight size={16} aria-hidden="true" />
                  </button>
                ) : null}
              </footer>
            </>
          ) : null}
        </div>
      </BorderBeam>
    </motion.aside>
  );
}
