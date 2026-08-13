import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  buildDeductionChains,
  findEvidentialSilences,
  rankKeystoneAssumptions,
  type CaseState,
  type InferenceRung,
} from '@thread/domain';
import { Eye, Quote, Scale, Split, TriangleAlert, X } from 'lucide-react';
import type { Selection } from '../model.js';
import { useDialogDismiss } from '../useDialogDismiss.js';

type Section = 'chains' | 'keystones' | 'silences';

const rungMeta: Record<
  InferenceRung['kind'],
  { label: string; icon: typeof Eye; hint: string }
> = {
  observed: { label: 'OBSERVED', icon: Eye, hint: 'Present in the artifact' },
  attested: { label: 'ATTESTED', icon: Quote, hint: 'Someone said it' },
  assumed: { label: 'ASSUMED', icon: Split, hint: 'The leap being taken' },
  opposed: { label: 'AGAINST', icon: TriangleAlert, hint: 'Pulls the other way' },
  concluded: { label: 'THEREFORE', icon: Scale, hint: 'Held, not proven' },
};

interface DeductionDrawerProps {
  state: CaseState;
  onSelect: (selection: Selection) => void;
  onClose: () => void;
}

export function DeductionDrawer({ state, onSelect, onClose }: DeductionDrawerProps) {
  useDialogDismiss(onClose);
  const reduceMotion = useReducedMotion();
  const chains = useMemo(() => buildDeductionChains(state), [state]);
  const keystones = useMemo(() => rankKeystoneAssumptions(state), [state]);
  const silences = useMemo(() => findEvidentialSilences(state), [state]);

  const [section, setSection] = useState<Section>('chains');
  const [chainId, setChainId] = useState(chains[0]?.id ?? '');
  const chain = chains.find((item) => item.id === chainId) ?? chains[0];

  const step = reduceMotion ? 0 : 0.055;

  return (
    <>
      <motion.button
        className="drawer-scrim"
        aria-label="Close deduction chains"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.aside
        className="deduction-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Deduction chains"
        initial={reduceMotion ? { opacity: 0 } : { x: '100%' }}
        animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
        exit={reduceMotion ? { opacity: 0 } : { x: '100%' }}
        transition={{ type: 'spring', stiffness: 260, damping: 32 }}
      >
        <header className="drawer-header">
          <div>
            <span className="kicker">METHOD</span>
            <h2>Deduction</h2>
            <p>What was seen, what was merely said, and the exact leap between them.</p>
          </div>
          <button aria-label="Close deduction chains" onClick={onClose} autoFocus>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="deduction-tabs" role="tablist" aria-label="Deduction sections">
          {(
            [
              ['chains', `Chains ${chains.length}`],
              ['keystones', `Keystones ${keystones.length}`],
              ['silences', `Silences ${silences.length}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={section === id}
              className={section === id ? 'is-active' : ''}
              onClick={() => setSection(id)}
            >
              {label}
              {section === id ? (
                <motion.i layoutId="deduction-tab" className="tab-underline" />
              ) : null}
            </button>
          ))}
        </div>

        <div className="deduction-body">
          {section === 'chains' && chain ? (
            <>
              <div className="chain-picker" role="listbox" aria-label="Deduction chains">
                {chains.map((item) => (
                  <button
                    key={item.id}
                    role="option"
                    aria-selected={item.id === chain.id}
                    className={item.id === chain.id ? 'is-active' : ''}
                    onClick={() => setChainId(item.id)}
                  >
                    <span>{item.conclusion}</span>
                    <b>{Math.round(item.confidence * 100)}</b>
                  </button>
                ))}
              </div>

              <AnimatePresence mode="wait">
                <motion.section
                  key={chain.id}
                  className="chain-view"
                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                  transition={{ duration: 0.24 }}
                >
                  <p className="chain-question">{chain.question}</p>

                  <ol className="ladder">
                    <motion.i
                      className="ladder-thread"
                      aria-hidden="true"
                      initial={reduceMotion ? false : { scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{
                        duration: reduceMotion ? 0 : chain.rungs.length * step + 0.25,
                        ease: 'linear',
                      }}
                    />
                    {chain.rungs.map((rung, index) => {
                      const meta = rungMeta[rung.kind];
                      const Icon = meta.icon;
                      const limiting = rung.id === chain.weakestRungId;
                      return (
                        <motion.li
                          key={rung.id}
                          className={`rung rung-${rung.kind} ${limiting ? 'is-limiting' : ''}`}
                          initial={reduceMotion ? false : { opacity: 0, x: -14 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{
                            delay: index * step,
                            duration: reduceMotion ? 0 : 0.34,
                            ease: [0.16, 1, 0.3, 1],
                          }}
                        >
                          <span className="rung-node" aria-hidden="true">
                            <Icon size={11} />
                          </span>
                          <div className="rung-copy">
                            <span className="rung-kind">
                              {meta.label}
                              <em>{meta.hint}</em>
                              {limiting ? <b>LIMITING STEP</b> : null}
                            </span>
                            <p>{rung.text}</p>
                            <small>{rung.detail}</small>
                            <div className="rung-sources">
                              {rung.sourceIds.map((id) => (
                                <button
                                  key={id}
                                  onClick={() => {
                                    if (state.evidence.some((item) => item.id === id))
                                      onSelect({ type: 'evidence', id });
                                    else if (
                                      state.observations.some((item) => item.id === id)
                                    )
                                      onSelect({ type: 'observation', id });
                                    else if (state.claims.some((item) => item.id === id))
                                      onSelect({ type: 'claim', id });
                                    else if (
                                      state.assumptions.some((item) => item.id === id)
                                    )
                                      onSelect({ type: 'assumption', id });
                                    else if (
                                      state.worldEdges.some((item) => item.id === id)
                                    )
                                      onSelect({ type: 'edge', id });
                                  }}
                                >
                                  {id}
                                </button>
                              ))}
                            </div>
                          </div>
                          <span className="rung-weight">
                            {Math.round(rung.weight * 100)}
                          </span>
                        </motion.li>
                      );
                    })}
                  </ol>

                  <div className="chain-falsifier">
                    <span className="section-eyebrow">THIS COLLAPSES IF</span>
                    <ul>
                      {chain.breaksIf.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                      {chain.breaksIf.length === 0 ? (
                        <li>
                          No warrant in this chain has a stated failure condition yet.
                        </li>
                      ) : null}
                    </ul>
                  </div>

                  {chain.alternatives.length > 0 ? (
                    <div className="chain-alternative">
                      <span className="section-eyebrow">SURVIVES THE SAME EVIDENCE</span>
                      <ul>
                        {chain.alternatives.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </motion.section>
              </AnimatePresence>
            </>
          ) : null}

          {section === 'keystones' ? (
            <section className="keystone-list">
              <p className="section-lede">
                If one of these turned out to be false, this is how much of the case would
                move with it.
              </p>
              {keystones.map((keystone, index) => (
                <motion.article
                  key={keystone.id}
                  className={`keystone-card is-${keystone.status}`}
                  initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * step, duration: 0.3 }}
                >
                  <header>
                    <button
                      onClick={() => onSelect({ type: 'assumption', id: keystone.id })}
                    >
                      {keystone.id}
                    </button>
                    <span className={`keystone-status is-${keystone.status}`}>
                      {keystone.status}
                    </span>
                  </header>
                  <h3>{keystone.label}</h3>
                  <p>{keystone.detail}</p>
                  <div
                    className="keystone-load"
                    aria-label={`Carries ${Math.round(keystone.load * 100)} percent of relationships`}
                  >
                    <motion.i
                      initial={reduceMotion ? false : { scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ delay: index * step + 0.1, duration: 0.5 }}
                      style={{ width: `${Math.max(3, keystone.load * 100)}%` }}
                    />
                  </div>
                  <small>
                    {keystone.dependentEdgeIds.length} relationships ·{' '}
                    {keystone.dependentBeliefIds.length} beliefs depend on it
                  </small>
                </motion.article>
              ))}
            </section>
          ) : null}

          {section === 'silences' ? (
            <section className="silence-list">
              <p className="section-lede">
                The evidence that is not here. Absence is a finding, not a gap to fill with
                confidence.
              </p>
              {silences.map((silence, index) => (
                <motion.article
                  key={silence.id}
                  className={`silence-card is-${silence.kind}`}
                  initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * step, duration: 0.3 }}
                >
                  <span className="silence-kind">{silence.kind.replaceAll('-', ' ')}</span>
                  <h3>{silence.label}</h3>
                  <p>{silence.detail}</p>
                  <small>Exposure {Math.round(silence.exposure * 100)}%</small>
                </motion.article>
              ))}
            </section>
          ) : null}
        </div>

        <footer className="deduction-footer">
          A CHAIN IS HELD, NEVER PROVEN · EVERY RUNG NAMES ITS SOURCE
        </footer>
      </motion.aside>
    </>
  );
}
