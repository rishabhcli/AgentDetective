import type { CaseState, LensId } from '@thread/domain';
import { CircleDotDashed, Eye, Layers3 } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { lazy, Suspense } from 'react';
import type { Selection } from '../model.js';

const BeliefGraph = lazy(() =>
  import('./BeliefGraph.js').then((module) => ({ default: module.BeliefGraph })),
);
const EvidenceGraph = lazy(() =>
  import('./EvidenceGraph.js').then((module) => ({ default: module.EvidenceGraph })),
);
const TimelineBoard = lazy(() =>
  import('./TimelineBoard.js').then((module) => ({ default: module.TimelineBoard })),
);
const WorldGraph = lazy(() =>
  import('./WorldGraph.js').then((module) => ({ default: module.WorldGraph })),
);

const lensCopy: Record<
  LensId,
  { index: string; title: string; description: string; layer: string; principle: string }
> = {
  people: {
    index: '01',
    title: 'People + relationships',
    description: 'Candidate identities, communications, and event participation.',
    layer: 'GRAPH B · WORLD',
    principle: 'A relationship remains qualified until its source chain survives review.',
  },
  time: {
    index: '02',
    title: 'Causal timeline',
    description: 'Source intervals and reconstructed events share one uncertain clock.',
    layer: 'GRAPH B · WORLD',
    principle: 'Vague language stays a range. It never becomes a convenient exact minute.',
  },
  place: {
    index: '03',
    title: 'Places + movement',
    description:
      'Locations become useful through qualified observations and travel events.',
    layer: 'GRAPH B · WORLD',
    principle: 'A location hit is weighted by precision, source, and valid time.',
  },
  objects: {
    index: '04',
    title: 'Objects + custody',
    description:
      'Follow the credential and vehicle across otherwise disconnected evidence.',
    layer: 'GRAPH B · WORLD',
    principle: 'Shared language suggests an object candidate; it does not prove sameness.',
  },
  evidence: {
    index: '05',
    title: 'Evidence provenance',
    description: 'Immutable artifacts contain observations and claims—not asserted truth.',
    layer: 'GRAPH A · EVIDENCE',
    principle: 'The source remains inspectable even when every interpretation changes.',
  },
  theory: {
    index: '06',
    title: 'Belief dependencies',
    description:
      'Competing explanations expose assumptions, challenges, and ATMS environments.',
    layer: 'GRAPH C · BELIEF',
    principle: 'Cut an assumption and only the dependent beliefs should move.',
  },
};

interface InvestigationBoardProps {
  state: CaseState;
  lens: LensId;
  selection: Selection | null;
  pulse: boolean;
  onSelect: (selection: Selection) => void;
}

export function InvestigationBoard({
  state,
  lens,
  selection,
  pulse,
  onSelect,
}: InvestigationBoardProps) {
  const reduceMotion = useReducedMotion();
  const copy = lensCopy[lens];
  // The board remounts on every lens change, so the mount animation is the
  // transition between projections.
  const enter = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 10 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.34, ease: [0.16, 1, 0.3, 1] as const },
      };
  const graphCount =
    lens === 'evidence'
      ? state.evidence.length + state.claims.length + state.observations.length
      : lens === 'theory'
        ? state.beliefs.length + state.assumptions.length
        : state.worldEdges.filter((edge) => edge.lenses.includes(lens)).length;
  return (
    <section className={`investigation-board ${pulse ? 'revision-pulse' : ''}`}>
      <motion.header className="board-header" {...enter}>
        <div className="board-index">{copy.index}</div>
        <div>
          <span className="kicker">{copy.layer}</span>
          <h2>{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
        <div className="board-stats">
          <span>
            <Layers3 size={13} aria-hidden="true" />
            {graphCount} linked records
          </span>
          <span>
            <CircleDotDashed size={13} aria-hidden="true" />
            {state.worldEdges.filter((edge) => edge.disputed).length} disputed strings
          </span>
        </div>
      </motion.header>
      <motion.div
        className="board-canvas"
        {...(reduceMotion
          ? {}
          : {
              initial: { opacity: 0 },
              animate: { opacity: 1 },
              transition: { duration: 0.4, delay: 0.06 },
            })}
      >
        <Suspense
          fallback={
            <div className="lens-loading" role="status">
              <span />
              <strong>Preparing {copy.title.toLowerCase()}…</strong>
            </div>
          }
        >
          {lens === 'evidence' ? (
            <EvidenceGraph state={state} selection={selection} onSelect={onSelect} />
          ) : lens === 'theory' ? (
            <BeliefGraph state={state} selection={selection} onSelect={onSelect} />
          ) : lens === 'time' ? (
            <TimelineBoard state={state} onSelect={onSelect} />
          ) : (
            <WorldGraph
              state={state}
              lens={lens}
              selection={selection}
              onSelect={onSelect}
            />
          )}
        </Suspense>
      </motion.div>
      <footer className="board-footer">
        <div>
          <Eye size={13} aria-hidden="true" />
          <span>{copy.principle}</span>
        </div>
        <div className="uncertainty-key" aria-label="Uncertainty encoding legend">
          <span>
            <i className="key-solid" /> High support
          </span>
          <span>
            <i className="key-dashed" /> Disputed
          </span>
          <span>
            <i className="key-fog" /> Low confidence
          </span>
        </div>
      </footer>
    </section>
  );
}
