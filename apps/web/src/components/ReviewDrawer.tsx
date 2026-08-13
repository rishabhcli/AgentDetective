import type { CaseState } from '@thread/domain';
import { motion } from 'motion/react';
import { useState, type FormEvent } from 'react';
import { Crosshair, LoaderCircle, Scale, Send, X } from 'lucide-react';
import type { AdversarialReviewResult } from '../api.js';
import { useDialogDismiss } from '../useDialogDismiss.js';
import { BorderBeam } from 'border-beam';
import { MetalFx } from 'metal-fx';
import { ThinkingOrb } from 'thinking-orbs';

interface ReviewDrawerProps {
  state: CaseState;
  busy: boolean;
  onReview: (question: string) => Promise<AdversarialReviewResult>;
  onClose: () => void;
}

const defaultQuestion =
  'Which reconstruction best explains the badge, vehicle, and access evidence, and what most strongly challenges it?';

export function ReviewDrawer({ state, busy, onReview, onClose }: ReviewDrawerProps) {
  useDialogDismiss(onClose);
  const [question, setQuestion] = useState(defaultQuestion);
  const [result, setResult] = useState<AdversarialReviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      setResult(await onReview(question));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The adversarial review failed.');
    }
  }

  return (
    <>
      <motion.button
        className="drawer-scrim"
        aria-label="Close adversarial review"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.aside
        className="review-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Adversarial review"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 320 }}
      >
        <header className="drawer-header">
          <div>
            <span className="kicker">OPENROUTER / TWO MODEL FAMILIES</span>
            <h2>Ask the case agents</h2>
            <p>Speak naturally. One agent explains; another attacks the account.</p>
          </div>
          <button aria-label="Close adversarial review" onClick={onClose} autoFocus>
            <X size={18} />
          </button>
        </header>
        <div className="review-body">
          <BorderBeam
            className="agent-beam-wrap"
            size="pulse-outside"
            colorVariant="mono"
            theme="dark"
            strength={busy ? 0.9 : 0.45}
            active
          >
            <form
              className="review-question agent-beam-composer"
              onSubmit={(event) => void submit(event)}
            >
              <div className="beam-agent-presence">
                <ThinkingOrb
                  state={busy ? 'solving' : 'breathing'}
                  size={64}
                  theme="dark"
                  aria-label={
                    busy ? 'Case agents are reviewing evidence' : 'Case agents ready'
                  }
                />
                <span>
                  <strong>
                    {busy ? 'Reviewing the case packet' : 'What do you want to test?'}
                  </strong>
                  <small>Hypothesis Engine + Falsifier</small>
                </span>
              </div>
              <label htmlFor="review-question">BOUNDED INVESTIGATIVE QUESTION</label>
              <textarea
                id="review-question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                minLength={8}
                maxLength={500}
                rows={4}
              />
              <div>
                <span>
                  {state.casePackets[0]?.retrievalMethod.replaceAll('-', ' ') ??
                    'Atlas packet will be assembled'}
                </span>
                <MetalFx preset="silver" theme="dark" strength={0.72} variant="circle">
                  <button
                    className="beam-send-button"
                    disabled={busy}
                    aria-label="Ask the agents"
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <Send size={17} />
                    )}
                  </button>
                </MetalFx>
              </div>
            </form>
          </BorderBeam>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          {result ? (
            <div className="review-result">
              <section className="model-opinion hypothesis-opinion">
                <div className="model-opinion-head">
                  <ThinkingOrb
                    state="solving"
                    size={20}
                    theme="dark"
                    paused
                    aria-label="Hypothesis Engine"
                  />
                  <span>
                    <small>HYPOTHESIS ENGINE</small>
                    <strong>{result.review.hypothesisModel}</strong>
                  </span>
                  <b>{result.review.hypothesis.leading_reconstruction_id}</b>
                </div>
                <p>{result.review.hypothesis.summary}</p>
                <dl>
                  <div>
                    <dt>Diagnostic IDs</dt>
                    <dd>
                      {result.review.hypothesis.diagnostic_evidence_ids.join(' · ') ||
                        'none returned'}
                    </dd>
                  </div>
                  <div>
                    <dt>Next question</dt>
                    <dd>{result.review.hypothesis.next_question}</dd>
                  </div>
                </dl>
              </section>
              <div className="adversarial-rule">
                <Scale size={14} />
                <span>INDEPENDENT MODEL FAMILY</span>
              </div>
              <section className="model-opinion falsifier-opinion">
                <div className="model-opinion-head">
                  <ThinkingOrb
                    state="searching"
                    size={20}
                    theme="dark"
                    paused
                    aria-label="Falsifier"
                  />
                  <span>
                    <small>FALSIFIER</small>
                    <strong>{result.review.falsifierModel}</strong>
                  </span>
                  <b>{result.review.falsifier.alternative_reconstruction_id}</b>
                </div>
                <p>{result.review.falsifier.strongest_counterargument}</p>
                <dl>
                  <div>
                    <dt>Contradicting IDs</dt>
                    <dd>
                      {result.review.falsifier.contradicting_ids.join(' · ') ||
                        'none returned'}
                    </dd>
                  </div>
                  <div>
                    <dt>Stop believing if</dt>
                    <dd>{result.review.falsifier.stop_believing_if}</dd>
                  </div>
                </dl>
              </section>
              <section className="review-provenance">
                <Crosshair size={15} aria-hidden="true" />
                <span>
                  <strong>{result.packet.id}</strong>
                  <small>
                    {result.packet.observationIds.length} observations ·{' '}
                    {result.packet.graphNeighborIds.length} graph neighbors · checkpoint{' '}
                    {result.run.checkpointId ?? 'none'}
                  </small>
                </span>
              </section>
            </div>
          ) : (
            <section className="empty-review-bench">
              <Scale size={25} aria-hidden="true" />
              <strong>
                No model opinion is shown until both live calls pass schema validation.
              </strong>
              <p>
                The outputs become belief memory only. They never become evidence or world
                facts.
              </p>
            </section>
          )}
        </div>
        <footer className="drawer-footer">
          MODEL OUTPUT IS A REVIEW RECORD · NOT AN EVIDENTIARY CLAIM
        </footer>
      </motion.aside>
    </>
  );
}
