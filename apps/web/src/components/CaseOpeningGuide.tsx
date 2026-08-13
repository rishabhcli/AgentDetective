import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';
import type { CaseState } from '@thread/domain';
import { useEffect, useRef, useState } from 'react';
import { BrandMark } from './BrandMark.js';

interface CaseOpeningGuideProps {
  state: CaseState;
  destination: 'board' | 'agents';
  onComplete: () => void;
  onBack: () => void;
}

function guideSteps(state: CaseState) {
  const topQuestion =
    state.anomalies
      .filter((item) => item.status === 'open')
      .sort((a, b) => b.expectedInformationGain - a.expectedInformationGain)[0] ??
    state.anomalies[0];
  const firstSource =
    state.evidence.find((item) => item.kind === 'image') ?? state.evidence[0];
  return [
    {
      id: 'brief',
      number: '01',
      icon: 'evidence',
      eyebrow: 'Start with the question',
      title: 'What are we trying to understand?',
      body: `${state.metadata.subtitle}. Begin with what the sources establish, keep party statements attributed, and leave the missing pieces visible.`,
      asideTitle: 'Start here',
      asideBody: topQuestion
        ? `Open question: ${topQuestion.question}`
        : 'Inspect the record, challenge assumptions, and choose the next useful question.',
    },
    {
      id: 'sources',
      number: '02',
      icon: 'camera',
      eyebrow: 'Read the board',
      title: 'Cards are sources, candidates, and questions.',
      body: 'Cream cards are preserved evidence. Dark cards are candidate people, objects, places, or events. Yellow notes are working accounts and open questions. A source can support a claim; it does not become a fact just because it is on the board.',
      asideTitle: 'Try this first',
      asideBody: firstSource
        ? `Open “${firstSource.title}.” Its inspector shows the preserved source, exact observations, and uncertainty.`
        : 'Open a source card to see its observations, claims, and uncertainty.',
    },
    {
      id: 'strings',
      number: '03',
      icon: 'relationship',
      eyebrow: 'Follow the reasoning',
      title: 'Every string is an inspectable argument.',
      body: 'A string names a real relationship. Its label, width, opacity, and dash show meaning and uncertainty. Open one to see supporting sources, opposition, assumptions, and what would make the relationship fail.',
      asideTitle: 'Nothing ornamental',
      asideBody:
        'If a relationship cannot name its sources and failure condition, it does not belong on this board.',
    },
    {
      id: 'agents',
      number: '04',
      icon: 'reconstruction',
      eyebrow: 'Ask THREAD',
      title: 'Name the outcome. Watch the relevant evidence change.',
      body: 'Ask a specific question or add evidence. THREAD recovers prior work, retrieves only relevant sources, challenges its lead, saves the run, and updates the board.',
      asideTitle: 'You stay in control',
      asideBody:
        'Every upload returns a real receipt. THREAD asks a clarification only when the file type conflicts with the evidence label.',
    },
  ] as const;
}

export function CaseOpeningGuide({
  state,
  destination,
  onComplete,
  onBack,
}: CaseOpeningGuideProps) {
  const [index, setIndex] = useState(0);
  const reduceMotion = useReducedMotion();
  const previousFocus = useRef<Element | null>(document.activeElement);
  const steps = guideSteps(state);
  const step = steps[index]!;
  const finalStep = index === steps.length - 1;

  useEffect(() => {
    const previous = previousFocus.current;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onComplete();
      if (event.key === 'ArrowRight' && !finalStep) setIndex((value) => value + 1);
      if (event.key === 'ArrowLeft' && index > 0) setIndex((value) => value - 1);
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      window.setTimeout(() => {
        if (document.querySelector('.case-opening-guide')) return;
        if (previous instanceof HTMLElement && document.body.contains(previous)) {
          previous.focus();
        }
      }, 0);
    };
  }, [finalStep, index, onComplete]);

  return (
    <motion.section
      className="case-opening-guide"
      role="dialog"
      aria-modal="true"
      aria-label="How this case works"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="case-guide-backdrop" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <header className="case-guide-header">
        <button onClick={onBack} className="case-guide-home">
          <ArrowLeft size={18} aria-hidden="true" />
          <BrandMark />
          <strong>THREAD</strong>
        </button>
        <div className="case-guide-case">
          <span>OPENING CASE</span>
          <strong>{state.metadata.reference}</strong>
        </div>
        <button
          className="case-guide-skip"
          onClick={onComplete}
          aria-label="Skip case guide"
        >
          Skip guide <X size={17} aria-hidden="true" />
        </button>
      </header>

      <div className="case-guide-layout">
        <nav className="case-guide-progress" aria-label="Case guide progress">
          {steps.map((item, itemIndex) => (
            <button
              key={item.id}
              className={
                itemIndex === index ? 'is-current' : itemIndex < index ? 'is-done' : ''
              }
              onClick={() => setIndex(itemIndex)}
              aria-current={itemIndex === index ? 'step' : undefined}
            >
              <span>{itemIndex < index ? <Check size={17} /> : item.number}</span>
              <strong>{item.eyebrow}</strong>
            </button>
          ))}
        </nav>

        <AnimatePresence mode="wait" initial={false}>
          <motion.article
            key={step.id}
            className="case-guide-content"
            initial={reduceMotion ? false : { opacity: 0, x: 42, filter: 'blur(8px)' }}
            animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
            exit={reduceMotion ? {} : { opacity: 0, x: -28, filter: 'blur(6px)' }}
            transition={{ duration: 0.48, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="case-guide-copy">
              <div className="case-guide-icon">
                <img src={`/icons/generated/${step.icon}.png`} alt="" />
              </div>
              <span className="case-guide-eyebrow">
                {step.number} / {String(steps.length).padStart(2, '0')} · {step.eyebrow}
              </span>
              <h1>{step.title}</h1>
              <p>{step.body}</p>
              <aside>
                <strong>{step.asideTitle}</strong>
                <p>{step.asideBody}</p>
              </aside>
            </div>
            <div className={`case-guide-visual visual-${step.id}`} aria-hidden="true">
              <div className="guide-cork-surface">
                <i className="guide-thread thread-one" />
                <i className="guide-thread thread-two" />
                <div className="guide-paper guide-paper-one">
                  <span />
                  <b>{step.id === 'brief' ? '21:09' : 'SOURCE'}</b>
                  <p>{step.id === 'agents' ? 'Case packet' : 'Preserved observation'}</p>
                </div>
                <div className="guide-paper guide-paper-two">
                  <span />
                  <b>{step.id === 'strings' ? '68% confidence' : 'OPEN QUESTION'}</b>
                  <p>{state.metadata.subtitle}</p>
                </div>
                <img src={`/icons/generated/${step.icon}.png`} alt="" />
              </div>
            </div>
          </motion.article>
        </AnimatePresence>
      </div>

      <footer className="case-guide-footer">
        <span>
          Case file {state.metadata.reference} <i /> Revision{' '}
          {String(state.metadata.revision).padStart(2, '0')}
        </span>
        <div>
          <button
            className="case-guide-previous"
            onClick={() => setIndex((value) => Math.max(0, value - 1))}
            disabled={index === 0}
          >
            <ArrowLeft size={17} aria-hidden="true" /> Previous
          </button>
          <button
            className="case-guide-next"
            onClick={() => (finalStep ? onComplete() : setIndex((value) => value + 1))}
            autoFocus
          >
            {finalStep
              ? destination === 'agents'
                ? 'Open the case agents'
                : 'Open the evidence board'
              : 'Continue'}
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </div>
      </footer>
    </motion.section>
  );
}
