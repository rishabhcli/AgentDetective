import { useRef } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  CircleDotDashed,
  Fingerprint,
  MousePointer2,
  ScanLine,
} from 'lucide-react';
import { MetalFx } from 'metal-fx';
import { ThinkingOrb } from 'thinking-orbs';
import type { CaseMetadata, CaseState, HealthStatus } from '@thread/domain';
import { BrandMark } from './BrandMark.js';

interface LandingPageProps {
  state: CaseState;
  cases: CaseMetadata[];
  health: HealthStatus | null;
  onEnter: () => void;
  onAskAgents: () => void;
  onChooseCase: (caseId: string) => void;
}

const heroWords = ['The', 'Agentic', 'Detective.'];

export function LandingPage({
  state,
  cases,
  health,
  onEnter,
  onAskAgents,
  onChooseCase,
}: LandingPageProps) {
  const reduceMotion = useReducedMotion();
  const pageRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ container: pageRef });
  const heroY = useTransform(scrollYProgress, [0, 0.32], [0, 150]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.22], [1, 0.2]);
  // The local deterministic research path is always a real case engine. Remote
  // model review enriches it, but is not a prerequisite for asking the case.
  const agentsReady = health?.ok ?? false;
  const realCase = !state.metadata.synthetic;
  const heroDescription = realCase
    ? 'A two-person team says it placed in a sponsor track. The organizer says another name appeared on the submission record. That record has never surfaced. Work the gap without turning an allegation into a fact.'
    : 'At 21:08, Badge C17 opened the east door. Fifty-one seconds later, Camera 4 caught an unknown entrant. Follow the trace before it disappears.';
  const leadQuestion =
    state.anomalies
      .filter((item) => item.status === 'open')
      .sort((a, b) => b.expectedInformationGain - a.expectedInformationGain)[0] ??
    state.anomalies[0];
  const featuredEvidence = state.evidence.slice(0, 2);

  return (
    <main className="landing-page landing-v2" ref={pageRef}>
      <div className="landing-noise" aria-hidden="true" />
      <div className="landing-orbit-field" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>

      <motion.header
        className="landing-nav landing-nav-v2"
        initial={reduceMotion ? false : { opacity: 0, y: -18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="landing-wordmark">
          <BrandMark />
          <strong>THREAD</strong>
        </div>
        <span className="landing-nav-principle">Private casework · San Francisco</span>
        <button onClick={onEnter}>
          Enter the case <ArrowUpRight size={15} aria-hidden="true" />
        </button>
      </motion.header>

      <motion.section
        className="landing-cinematic-hero"
        {...(reduceMotion ? {} : { style: { y: heroY, opacity: heroOpacity } })}
      >
        <div className="landing-hero-kicker">
          <span>
            <Fingerprint size={13} aria-hidden="true" />{' '}
            {realCase
              ? 'Anonymized real case · user-authorized'
              : 'Fictional case file · Badge 17'}
          </span>
        </div>
        <h1 aria-label="The Agentic Detective.">
          {heroWords.map((word, index) => (
            <motion.span
              key={word + index}
              initial={reduceMotion ? false : { opacity: 0, y: 70, filter: 'blur(12px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{
                duration: 0.9,
                delay: 0.18 + index * 0.08,
                ease: [0.16, 1, 0.3, 1],
              }}
              className={index === 0 ? 'is-whisper' : index === 2 ? 'is-italic' : ''}
            >
              {word}
            </motion.span>
          ))}
        </h1>
        <motion.p
          initial={reduceMotion ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.86 }}
        >
          {heroDescription}
        </motion.p>
        <motion.div
          className="landing-hero-actions"
          initial={reduceMotion ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 1.02 }}
        >
          <MetalFx key={state.metadata.id} preset="silver" theme="dark" strength={0.86}>
            <button className="landing-primary-action" onClick={onEnter}>
              {realCase ? 'Open the prize dispute' : 'Open Case 17'}{' '}
              <ArrowUpRight size={17} aria-hidden="true" />
            </button>
          </MetalFx>
          <button
            className="landing-agent-action"
            onClick={onAskAgents}
            disabled={!agentsReady}
          >
            <ThinkingOrb state="solving" size={20} theme="dark" paused />
            {agentsReady ? 'Ask THREAD' : 'Case engine loading'}
          </button>
        </motion.div>
        <div className="landing-scroll-cue" aria-hidden="true">
          <MousePointer2 size={14} />
          <span>A clue is waiting below</span>
          <ArrowDown size={14} />
        </div>
      </motion.section>

      <section className="landing-case-library" aria-label="Open investigations">
        <header>
          <span>OPEN INVESTIGATIONS</span>
          <strong>Choose a case with an honest evidence boundary.</strong>
        </header>
        <div>
          {cases.map((item) => (
            <button
              key={item.id}
              className={item.id === state.metadata.id ? 'is-active' : ''}
              aria-pressed={item.id === state.metadata.id}
              onClick={() => onChooseCase(item.id)}
            >
              <span>{item.synthetic ? 'CONTROLLED FICTION' : 'ANONYMIZED REAL CASE'}</span>
              <strong>{item.title}</strong>
              <small>{item.subtitle}</small>
              <i>{item.id === state.metadata.id ? 'Open now' : 'Load case'}</i>
            </button>
          ))}
        </div>
      </section>

      <section className="landing-board-reveal">
        <motion.div
          className="landing-cork-slab"
          initial={reduceMotion ? false : { opacity: 0, y: 100, rotateX: 12, scale: 0.92 }}
          whileInView={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
        >
          <svg className="landing-board-strings" viewBox="0 0 1200 650" aria-hidden="true">
            <path d="M205 145 C370 38 405 303 588 215 S821 71 1000 156" />
            <path d="M214 465 C390 598 451 325 632 422 S829 560 1000 442" />
            <path d="M588 215 C642 280 621 349 632 422" />
          </svg>
          <motion.button
            className="landing-pinned-card pinned-source"
            onClick={onEnter}
            {...(reduceMotion ? {} : { whileHover: { rotate: 0, scale: 1.06, y: -12 } })}
          >
            <i className="landing-pin" />
            <span>
              {featuredEvidence[0]?.id ?? 'SOURCE'} ·{' '}
              {(featuredEvidence[0]?.kind ?? 'evidence').toUpperCase()}
            </span>
            {realCase ? (
              <div className="landing-document-frame" aria-hidden="true">
                <b />
                <b />
                <b />
                <i />
              </div>
            ) : (
              <div className="landing-cam-frame" aria-hidden="true">
                <b />
                <b />
              </div>
            )}
            <strong>{featuredEvidence[0]?.title ?? 'Preserved source'}</strong>
            <small>
              {realCase
                ? 'Party statement retained as a claim · central record still missing'
                : 'Unidentified entrant · dark sedan · 21:09'}
            </small>
          </motion.button>
          <motion.button
            className="landing-pinned-card pinned-message"
            onClick={onEnter}
            {...(reduceMotion ? {} : { whileHover: { rotate: 0, scale: 1.06, y: -12 } })}
          >
            <i className="landing-pin" />
            <span>
              {featuredEvidence[1]?.id ?? 'SOURCE'} ·{' '}
              {(featuredEvidence[1]?.kind ?? 'evidence').toUpperCase()}
            </span>
            <strong>
              {realCase ? featuredEvidence[1]?.title : '“did J ever get the badge…”'}
            </strong>
            <small>
              {realCase
                ? 'Dated public corroboration · does not prove prize delivery'
                : 'Recovered message · sender identities retained · “J” unresolved'}
            </small>
          </motion.button>
          <motion.button
            className="landing-pinned-card pinned-question"
            onClick={onEnter}
            {...(reduceMotion ? {} : { whileHover: { rotate: 0, scale: 1.06, y: -12 } })}
          >
            <i className="landing-pin" />
            <span>{realCase ? 'MISSING RECORD' : 'UNRESOLVED IDENTITY'}</span>
            <strong>{leadQuestion?.question ?? 'What should be checked next?'}</strong>
            <small>
              {realCase
                ? 'The record required to verify the recipient remains absent.'
                : 'Three candidates remain. No source confirms the binding.'}
            </small>
          </motion.button>
          <motion.button
            className="landing-pinned-card pinned-account"
            onClick={onEnter}
            {...(reduceMotion ? {} : { whileHover: { rotate: 0, scale: 1.06, y: -12 } })}
          >
            <i className="landing-pin" />
            <span>LEADING ACCOUNT</span>
            <strong>{state.reconstructions.find((item) => item.isLeading)?.title}</strong>
            <small>
              {state.reconstructions.find((item) => item.isLeading)?.coveragePercent}%
              coverage · still falsifiable
            </small>
          </motion.button>
          <div className="landing-board-caption">
            <span>{state.evidence.length} immutable artifacts</span>
            <span>{state.worldEdges.length} inspectable strings</span>
            <span>{state.reconstructions.length} competing accounts</span>
          </div>
        </motion.div>
      </section>

      <section className="landing-mystery">
        <motion.header
          initial={reduceMotion ? false : { opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{ duration: 0.8 }}
        >
          <span>THE FIRST CONTRADICTION</span>
          <h2>
            {realCase ? 'The placement is documented.' : 'The badge opened the door.'}
            <em>
              {realCase
                ? 'The recipient record is still missing.'
                : 'The camera could not name who walked through.'}
            </em>
          </h2>
          <p>
            {realCase
              ? 'The organizer’s explanation depends on a form no one has seen. The shortest path is not another theory—it is the record itself.'
              : 'Two machine records, fifty-one seconds apart. Somewhere between them is the person this case cannot yet identify.'}
          </p>
        </motion.header>
        <div className="landing-mystery-scene">
          <motion.figure
            className="mystery-camera"
            initial={reduceMotion ? false : { opacity: 0, x: -55 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, amount: 0.45 }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          >
            <figcaption>
              <span>
                {realCase ? 'SUBMISSION RECORD · REQUESTED' : 'CAMERA 04 · EAST DOOR'}
              </span>
              <strong>{realCase ? 'NOT PRODUCED' : '21:09:03'}</strong>
            </figcaption>
            <div aria-hidden="true">
              <i />
              <b />
              <ScanLine size={22} />
              <span>
                {realCase ? 'SYSTEM OF RECORD / MISSING' : 'IDENTITY / UNRESOLVED'}
              </span>
            </div>
          </motion.figure>

          <svg className="mystery-string" viewBox="0 0 620 320" aria-hidden="true">
            <path d="M56 230 C205 60 384 295 567 92" />
            <circle cx="56" cy="230" r="6" />
            <circle cx="567" cy="92" r="6" />
          </svg>

          <motion.article
            className="mystery-note"
            initial={reduceMotion ? false : { opacity: 0, x: 55, rotate: 2 }}
            whileInView={{ opacity: 1, x: 0, rotate: 1.2 }}
            viewport={{ once: true, amount: 0.45 }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            {...(reduceMotion ? {} : { whileHover: { y: -10, rotate: 0 } })}
          >
            <span className="mystery-note-kicker">
              {realCase ? 'UNRESOLVED · ONE DECISIVE RECORD' : 'UNRESOLVED · 03 CANDIDATES'}
            </span>
            <CircleDotDashed size={30} aria-hidden="true" />
            <blockquote>
              {realCase
                ? 'Another name appeared on the form.'
                : '“did J ever get the badge from rob”'}
            </blockquote>
            <h3>{leadQuestion?.question ?? 'What record resolves this?'}</h3>
            <p>
              {realCase
                ? 'THREAD keeps the organizer’s statement, the participant’s statement, and the checked negatives separate until a source closes the gap.'
                : 'Every answer changes the timeline. The agents keep the alternatives alive until another clue closes the distance.'}
            </p>
            <i className="card-hover-line" />
          </motion.article>

          <motion.aside
            className="mystery-timeline"
            initial={reduceMotion ? false : { opacity: 0, y: 35 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ duration: 0.75, delay: 0.16 }}
          >
            <span>
              <b>{realCase ? 'AUG 03' : '21:08:12'}</b>
              {realCase ? 'PLACEMENT CLAIMED' : 'C17 ACCEPTED'}
            </span>
            <i>{realCase ? '+ 08 DAYS' : '+ 00:00:51'}</i>
            <span>
              <b>{realCase ? 'AUG 11' : '21:09:03'}</b>
              {realCase ? 'RECORD STILL MISSING' : 'UNKNOWN ENTRANT'}
            </span>
          </motion.aside>
        </div>
        <div className="landing-mystery-caption" aria-hidden="true">
          <span>THE FIRST CONTRADICTION</span>
          <strong>
            {realCase
              ? 'Eight days separate the first request from the last captured deferral.'
              : '51 seconds separate access from appearance.'}
          </strong>
          <p>
            {realCase
              ? 'One party statement. One absent record. The case begins where verification stops.'
              : 'Two records. One unresolved identity. The case begins in the gap.'}
          </p>
        </div>
      </section>

      <section className="landing-agent-stage">
        <motion.div
          className="agent-stage-copy"
          initial={reduceMotion ? false : { opacity: 0, x: -60 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        >
          <span>SEVEN CASE AGENTS</span>
          <h2>Give THREAD something concrete to verify.</h2>
          <p>
            It retrieves the relevant evidence, tests competing accounts, and shows the
            source trail for every completed agent check.
          </p>
          <button onClick={onAskAgents} disabled={!agentsReady}>
            Ask THREAD <ArrowUpRight size={15} />
          </button>
        </motion.div>
        <motion.div
          className="landing-orb-constellation"
          initial={reduceMotion ? false : { opacity: 0, x: 60 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.35 }}
          transition={{ duration: 0.9, delay: 0.12 }}
        >
          {[
            ['Ingestor', 'composing'],
            ['Resolver', 'connecting'],
            ['Chronologist', 'weaving'],
            ['Linker', 'connecting'],
            ['Hypothesis', 'solving'],
            ['Falsifier', 'searching'],
            ['Investigator', 'working'],
          ].map(([name, orb], index) => (
            <motion.button
              key={name ?? `agent-${index}`}
              onClick={onAskAgents}
              disabled={!agentsReady}
              initial={reduceMotion ? false : { opacity: 0, scale: 0.6 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.55, delay: index * 0.07 }}
              {...(reduceMotion ? {} : { whileHover: { y: -8, scale: 1.05 } })}
            >
              <ThinkingOrb
                state={orb as 'composing'}
                size={20}
                theme="dark"
                paused
                aria-label={`${name} agent ready`}
              />
              <span>
                <strong>{name}</strong>
                <small>ready</small>
              </span>
              <Check size={13} aria-hidden="true" />
            </motion.button>
          ))}
        </motion.div>
      </section>

      <section className="landing-final-cta">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 60, scale: 0.96 }}
          whileInView={{ opacity: 1, y: 0, scale: 1 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        >
          <span>{state.metadata.title.toLocaleUpperCase()}</span>
          <h2>{realCase ? 'Find the missing record.' : 'Pull the first thread.'}</h2>
          <p>
            {realCase
              ? 'The placement has support. The recipient and delivery records do not.'
              : 'The badge log says one thing. The camera leaves another possibility open.'}
          </p>
          <MetalFx preset="silver" theme="dark" strength={0.88}>
            <button onClick={onEnter}>
              Enter the live case <ArrowUpRight size={17} />
            </button>
          </MetalFx>
        </motion.div>
      </section>

      <footer className="landing-footer landing-footer-v2">
        <span>THREAD / THE AGENTIC DETECTIVE</span>
        <span>
          {state.metadata.reference} · {state.metadata.location}
        </span>
      </footer>
    </main>
  );
}
