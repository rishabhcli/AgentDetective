import { motion } from 'motion/react';
import type { CaseState, TimeInterval } from '@thread/domain';
import {
  AlertOctagon,
  ArrowDown,
  CheckCircle2,
  Clock3,
  FileKey2,
  Fingerprint,
  GitBranch,
  Hash,
  Link2,
  Quote,
  Scale,
  ShieldQuestion,
  X,
} from 'lucide-react';
import type { Selection } from '../model.js';
import { useDialogDismiss } from '../useDialogDismiss.js';

interface InspectorProps {
  state: CaseState;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onClose: () => void;
  /** Absent when the case cannot currently accept a mutation. */
  onChallenge?: (assumptionId: string) => void;
  challengeBusy?: boolean;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatInterval(interval: TimeInterval | null): string {
  if (!interval) return 'No valid-time interval recorded';
  const format = (value: string) =>
    new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Los_Angeles',
    }).format(new Date(value));
  return interval.earliest === interval.latest
    ? format(interval.earliest)
    : `${format(interval.earliest)} → ${format(interval.latest)}`;
}

function selectionForId(state: CaseState, id: string): Selection | null {
  if (state.evidence.some((item) => item.id === id)) return { type: 'evidence', id };
  if (state.claims.some((item) => item.id === id)) return { type: 'claim', id };
  if (state.observations.some((item) => item.id === id)) return { type: 'observation', id };
  if (state.entities.some((item) => item.id === id)) return { type: 'entity', id };
  if (state.unresolvedReferences.some((item) => item.id === id))
    return { type: 'reference', id };
  if (state.assumptions.some((item) => item.id === id)) return { type: 'assumption', id };
  if (state.beliefs.some((item) => item.id === id)) return { type: 'belief', id };
  return null;
}

export function Inspector({
  state,
  selection,
  onSelect,
  onClose,
  onChallenge,
  challengeBusy,
}: InspectorProps) {
  useDialogDismiss(onClose);
  const title = (() => {
    switch (selection.type) {
      case 'edge':
        return state.worldEdges
          .find((item) => item.id === selection.id)
          ?.predicate.replaceAll('_', ' ');
      case 'evidence':
        return state.evidence.find((item) => item.id === selection.id)?.title;
      case 'entity':
        return state.entities.find((item) => item.id === selection.id)?.label;
      case 'claim':
        return state.claims.find((item) => item.id === selection.id)?.proposition;
      case 'observation':
        return state.observations.find((item) => item.id === selection.id)?.text;
      case 'reference':
        return `Unresolved “${state.unresolvedReferences.find((item) => item.id === selection.id)?.surfaceForm ?? '?'}”`;
      case 'assumption':
        return state.assumptions.find((item) => item.id === selection.id)?.label;
      case 'belief':
        return state.beliefs.find((item) => item.id === selection.id)?.label;
      case 'belief-edge':
        return state.beliefEdges.find((item) => item.id === selection.id)?.predicate;
    }
  })();

  return (
    <>
      <motion.button
        className="drawer-scrim"
        aria-label="Close inspector"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.aside
        className="inspector-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Inspect ${title ?? selection.id}`}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 320 }}
      >
        <header className="drawer-header">
          <div>
            <span className="kicker">INSPECT / {selection.type.replaceAll('-', ' ')}</span>
            <h2>{title ?? selection.id}</h2>
          </div>
          <button aria-label="Close inspector" onClick={onClose} autoFocus>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="drawer-body">
          <InspectorBody
            state={state}
            selection={selection}
            onSelect={onSelect}
            {...(onChallenge ? { onChallenge } : {})}
            {...(challengeBusy === undefined ? {} : { challengeBusy })}
          />
        </div>
        <footer className="drawer-footer">
          <Fingerprint size={14} aria-hidden="true" />
          SOURCE TRAIL · SUPPORT · CONTRADICTIONS · REVISION HISTORY
        </footer>
      </motion.aside>
    </>
  );
}

function InspectorBody({
  state,
  selection,
  onSelect,
  onChallenge,
  challengeBusy,
}: Pick<
  InspectorProps,
  'state' | 'selection' | 'onSelect' | 'onChallenge' | 'challengeBusy'
>) {
  if (selection.type === 'edge') {
    const edge = state.worldEdges.find((item) => item.id === selection.id);
    if (!edge) return <MissingRecord id={selection.id} />;
    const subject = state.entities.find((item) => item.id === edge.subjectId);
    const object = state.entities.find((item) => item.id === edge.objectId);
    const support = edge.contributions.filter((item) => item.polarity === 'support');
    const oppose = edge.contributions.filter((item) => item.polarity === 'oppose');
    return (
      <>
        <section className="string-argument">
          <span className="inspector-section-label">EVERY STRING IS AN ARGUMENT</span>
          <div className="argument-equation">
            <button onClick={() => onSelect({ type: 'entity', id: edge.subjectId })}>
              <small>{subject?.kind}</small>
              <strong>{subject?.label ?? edge.subjectId}</strong>
            </button>
            <div>
              <span>{edge.predicate.replaceAll('_', ' ')}</span>
              <i className={edge.disputed ? 'is-disputed' : ''} />
              <strong>{percent(edge.confidence)}</strong>
            </div>
            <button onClick={() => onSelect({ type: 'entity', id: edge.objectId })}>
              <small>{object?.kind}</small>
              <strong>{object?.label ?? edge.objectId}</strong>
            </button>
          </div>
          <div className="argument-status-row">
            <span className={edge.disputed ? 'status-disputed' : 'status-supported'}>
              {edge.disputed ? <AlertOctagon size={13} /> : <CheckCircle2 size={13} />}
              {edge.disputed ? 'DISPUTED' : 'SUPPORTED'}
            </span>
            <span>{edge.createdByAgent.toUpperCase()}</span>
            <span>{edge.id}</span>
          </div>
        </section>
        <ContributionList title="FOR" items={support} state={state} onSelect={onSelect} />
        <ContributionList
          title="AGAINST"
          items={oppose}
          state={state}
          onSelect={onSelect}
        />
        <section className="inspector-section">
          <span className="inspector-section-label">VALID TIME</span>
          <p className="icon-line">
            <Clock3 size={14} aria-hidden="true" /> {formatInterval(edge.validTime)}
          </p>
          <p className="muted-copy">
            Transaction time: {new Date(edge.transactionTime).toLocaleString()}
          </p>
        </section>
        {edge.assumptionIds.length > 0 ? (
          <section className="inspector-section">
            <span className="inspector-section-label">ASSUMPTION DEPENDENCIES</span>
            <div className="source-chip-list">
              {edge.assumptionIds.map((id) => (
                <button key={id} onClick={() => onSelect({ type: 'assumption', id })}>
                  <GitBranch size={12} /> {id}
                </button>
              ))}
            </div>
          </section>
        ) : null}
        {edge.alternatives.length > 0 ? (
          <section className="inspector-section alternative-box">
            <span className="inspector-section-label">LIVE ALTERNATIVES</span>
            <ul>
              {edge.alternatives.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </>
    );
  }

  if (selection.type === 'evidence') {
    const artifact = state.evidence.find((item) => item.id === selection.id);
    if (!artifact) return <MissingRecord id={selection.id} />;
    return (
      <>
        <section className="evidence-stamp-card">
          <div>
            <FileKey2 size={21} aria-hidden="true" />
            <span>{artifact.id}</span>
          </div>
          <strong>{artifact.kind.toUpperCase()}</strong>
          <small>
            {artifact.synthetic
              ? 'SYNTHETIC FIXTURE'
              : artifact.extractor === 'redacted-case-derivative'
                ? 'ANONYMIZED REAL-CASE DERIVATIVE'
                : 'USER PROVIDED'}
          </small>
        </section>
        <dl className="record-fields">
          <div>
            <dt>Source</dt>
            <dd>{artifact.sourceLabel}</dd>
          </div>
          <div>
            <dt>File</dt>
            <dd>{artifact.fileName}</dd>
          </div>
          <div>
            <dt>MIME</dt>
            <dd>{artifact.mimeType}</dd>
          </div>
          <div>
            <dt>Extractor</dt>
            <dd>{artifact.extractor}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{artifact.extractionStatus}</dd>
          </div>
          <div>
            <dt>Ingested</dt>
            <dd>{new Date(artifact.ingestedAt).toLocaleString()}</dd>
          </div>
        </dl>
        <section className="hash-block">
          <span>
            <Hash size={12} /> SHA-256
          </span>
          <code>{artifact.sha256}</code>
        </section>
        <section className="inspector-section">
          <span className="inspector-section-label">CHAIN OF CUSTODY</span>
          <p>{artifact.chainOfCustody}</p>
        </section>
        {artifact.content ? (
          <section className="source-excerpt">
            <span className="inspector-section-label">PRESERVED SOURCE CONTENT</span>
            <pre>{artifact.content}</pre>
          </section>
        ) : (
          <section className="adapter-warning">
            <ShieldQuestion size={18} />
            <div>
              <strong>No semantic description generated.</strong>
              <p>This binary requires a configured multimodal extractor.</p>
            </div>
          </section>
        )}
        <LinkedRecords
          title="OBSERVATIONS"
          ids={artifact.observationIds}
          state={state}
          onSelect={onSelect}
        />
        <LinkedRecords
          title="CLAIMS"
          ids={artifact.claimIds}
          state={state}
          onSelect={onSelect}
        />
        {artifact.challengedByEvidenceIds.length > 0 ? (
          <LinkedRecords
            title="CHALLENGED BY"
            ids={artifact.challengedByEvidenceIds}
            state={state}
            onSelect={onSelect}
          />
        ) : null}
      </>
    );
  }

  if (selection.type === 'entity') {
    const entity = state.entities.find((item) => item.id === selection.id);
    if (!entity) return <MissingRecord id={selection.id} />;
    const related = state.worldEdges.filter(
      (edge) => edge.subjectId === entity.id || edge.objectId === entity.id,
    );
    return (
      <>
        <section className="entity-identity-card">
          <div>{entity.shortLabel}</div>
          <span>
            <small>{entity.kind.toUpperCase()}</small>
            <strong>{entity.label}</strong>
            <p>{entity.description}</p>
          </span>
        </section>
        <section className="confidence-card">
          <span className="inspector-section-label">ENTITY CONFIDENCE</span>
          <strong>{percent(entity.confidence)}</strong>
          <i>
            <b style={{ width: percent(entity.confidence) }} />
          </i>
        </section>
        <section className="inspector-section">
          <span className="inspector-section-label">MENTIONED AS</span>
          <div className="alias-list">
            {entity.aliases.map((alias) => (
              <span key={alias}>{alias}</span>
            ))}
          </div>
        </section>
        {Object.keys(entity.properties).length > 0 ? (
          <dl className="record-fields">
            {Object.entries(entity.properties).map(([key, values]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{values.join(', ')}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <section className="inspector-section">
          <span className="inspector-section-label">CONNECTED STRINGS</span>
          <div className="linked-record-list">
            {related.map((edge) => (
              <button key={edge.id} onClick={() => onSelect({ type: 'edge', id: edge.id })}>
                <span>{edge.predicate.replaceAll('_', ' ')}</span>
                <strong>{percent(edge.confidence)}</strong>
                <ArrowDown size={12} />
              </button>
            ))}
          </div>
        </section>
        <LinkedRecords
          title="SOURCE ARTIFACTS"
          ids={entity.sourceEvidenceIds}
          state={state}
          onSelect={onSelect}
        />
      </>
    );
  }

  if (selection.type === 'claim') {
    const claim = state.claims.find((item) => item.id === selection.id);
    if (!claim) return <MissingRecord id={selection.id} />;
    return (
      <>
        <section className="quote-card">
          <Quote size={18} />
          <blockquote>{claim.verbatim}</blockquote>
          <cite>{claim.speaker ?? 'Document statement'}</cite>
        </section>
        <section className="inspector-section">
          <span className="inspector-section-label">BOUNDED PROPOSITION</span>
          <p>{claim.proposition}</p>
        </section>
        <div className="dual-confidence">
          <section>
            <span>EXTRACTION</span>
            <strong>{percent(claim.extractionConfidence)}</strong>
            <small>Did THREAD preserve the statement?</small>
          </section>
          <section>
            <span>EVIDENTIARY</span>
            <strong>
              {claim.sourceReliability}
              {claim.informationCredibility}
            </strong>
            <small>Admiralty source × credibility</small>
          </section>
        </div>
        {claim.hedges.length > 0 ? (
          <section className="inspector-section">
            <span className="inspector-section-label">LINGUISTIC UNCERTAINTY</span>
            <div className="alias-list">
              {claim.hedges.map((hedge) => (
                <span key={hedge}>“{hedge}”</span>
              ))}
            </div>
          </section>
        ) : null}
        <section className="inspector-section">
          <span className="inspector-section-label">REPORTED TIME</span>
          <p>{formatInterval(claim.interval)}</p>
        </section>
        <LinkedRecords
          title="SOURCE ARTIFACT"
          ids={[claim.sourceEvidenceId]}
          state={state}
          onSelect={onSelect}
        />
        <LinkedRecords
          title="UNRESOLVED REFERENCES"
          ids={claim.unresolvedReferenceIds}
          state={state}
          onSelect={onSelect}
        />
      </>
    );
  }

  if (selection.type === 'observation') {
    const observation = state.observations.find((item) => item.id === selection.id);
    if (!observation) return <MissingRecord id={selection.id} />;
    return (
      <>
        <section className="observation-card">
          <span>{observation.id}</span>
          <strong>{observation.text}</strong>
          <small>
            {observation.kind.toUpperCase()} · {observation.locator}
          </small>
        </section>
        <section className="confidence-card">
          <span className="inspector-section-label">EXTRACTION CONFIDENCE</span>
          <strong>{percent(observation.extractionConfidence)}</strong>
          <i>
            <b style={{ width: percent(observation.extractionConfidence) }} />
          </i>
        </section>
        <section className="inspector-section">
          <span className="inspector-section-label">SOURCE TIME INTERVAL</span>
          <p>{formatInterval(observation.interval)}</p>
          {observation.interval ? (
            <small>
              {percent(observation.interval.confidence)} temporal confidence ·{' '}
              {observation.interval.precision}
            </small>
          ) : null}
        </section>
        <LinkedRecords
          title="SOURCE ARTIFACT"
          ids={[observation.sourceEvidenceId]}
          state={state}
          onSelect={onSelect}
        />
        <LinkedRecords
          title="ENTITY CANDIDATES"
          ids={observation.entityIds}
          state={state}
          onSelect={onSelect}
        />
      </>
    );
  }

  if (selection.type === 'reference') {
    const reference = state.unresolvedReferences.find((item) => item.id === selection.id);
    if (!reference) return <MissingRecord id={selection.id} />;
    return (
      <>
        <section className="reference-context">
          <span>
            {reference.id} · {reference.status.toUpperCase()}
          </span>
          <Quote size={18} />
          <blockquote>{reference.context}</blockquote>
          <p>
            The source wording remains unchanged regardless of the current leading
            candidate.
          </p>
        </section>
        <section className="inspector-section">
          <span className="inspector-section-label">CANDIDATE BINDINGS</span>
          <div className="candidate-list">
            {reference.candidateBindings.map((candidate) => (
              <button
                key={candidate.label}
                disabled={!candidate.entityId}
                onClick={() =>
                  candidate.entityId && onSelect({ type: 'entity', id: candidate.entityId })
                }
              >
                <span>
                  <strong>{candidate.label}</strong>
                  <small>
                    prior {percent(candidate.prior)} · {candidate.signalIds.length} applied
                    signals
                  </small>
                </span>
                <b>{percent(candidate.probability)}</b>
                <i>
                  <em style={{ width: percent(candidate.probability) }} />
                </i>
              </button>
            ))}
          </div>
        </section>
        <section className="inspector-section">
          <span className="inspector-section-label">RESOLUTION SIGNALS</span>
          <div className="signal-list">
            {reference.resolutionSignals.length ? (
              reference.resolutionSignals.map((signal) => (
                <button
                  key={signal.id}
                  onClick={() => onSelect({ type: 'evidence', id: signal.evidenceId })}
                >
                  <span>{signal.channel.toUpperCase()}</span>
                  <strong>{signal.label}</strong>
                  <small>
                    {signal.evidenceId} · weight {signal.weight.toFixed(2)}
                  </small>
                </button>
              ))
            ) : (
              <p className="muted-copy">
                No explicit resolution signals have been recorded.
              </p>
            )}
          </div>
        </section>
      </>
    );
  }

  if (selection.type === 'assumption') {
    const assumption = state.assumptions.find((item) => item.id === selection.id);
    if (!assumption) return <MissingRecord id={selection.id} />;
    const dependents = state.beliefs.filter((belief) =>
      belief.environments.some((environment) => environment.includes(assumption.id)),
    );
    const dependentEdges = state.worldEdges.filter((edge) =>
      edge.assumptionIds.includes(assumption.id),
    );
    return (
      <>
        <section className={`assumption-card is-${assumption.status}`}>
          <GitBranch size={22} />
          <span>
            <small>{assumption.id} · ASSUMPTION</small>
            <strong>{assumption.label}</strong>
            <p>{assumption.detail}</p>
          </span>
          <b>{assumption.status.toUpperCase()}</b>
        </section>
        {assumption.invalidatedByEvidenceId ? (
          <section className="invalidated-box">
            <AlertOctagon size={18} />
            <span>
              <small>INVALIDATED BY</small>
              <button
                onClick={() =>
                  onSelect({ type: 'evidence', id: assumption.invalidatedByEvidenceId! })
                }
              >
                {assumption.invalidatedByEvidenceId}
              </button>
            </span>
          </section>
        ) : null}
        <LinkedRecords
          title="SOURCE ARTIFACTS"
          ids={assumption.sourceEvidenceIds}
          state={state}
          onSelect={onSelect}
        />
        <section className="inspector-section">
          <span className="inspector-section-label">DEPENDENT BELIEFS</span>
          <div className="linked-record-list">
            {dependents.map((belief) => (
              <button
                key={belief.id}
                onClick={() => onSelect({ type: 'belief', id: belief.id })}
              >
                <span>{belief.label}</span>
                <strong>{belief.status}</strong>
                <ArrowDown size={12} />
              </button>
            ))}
          </div>
        </section>
        {onChallenge && assumption.status !== 'invalid' ? (
          <section className="inspector-section challenge-section">
            <span className="inspector-section-label">IF THIS IS WRONG</span>
            <p className="challenge-exposure">
              {dependentEdges.length} relationship
              {dependentEdges.length === 1 ? '' : 's'} and {dependents.length} belief
              {dependents.length === 1 ? '' : 's'} rest on this. Invalidating it reduces
              each of them and rebuilds the accounts that required it. Nothing is deleted.
            </p>
            <button
              className="button button-danger"
              disabled={challengeBusy}
              onClick={() => onChallenge(assumption.id)}
            >
              <AlertOctagon size={15} aria-hidden="true" />
              {challengeBusy ? 'Cascading…' : 'Invalidate this assumption'}
            </button>
          </section>
        ) : null}
      </>
    );
  }

  if (selection.type === 'belief') {
    const belief = state.beliefs.find((item) => item.id === selection.id);
    if (!belief) return <MissingRecord id={selection.id} />;
    const incoming = state.beliefEdges.filter((edge) => edge.targetId === belief.id);
    return (
      <>
        <section className={`belief-card is-${belief.status}`}>
          <Scale size={21} />
          <span>
            <small>
              {belief.id} · {belief.kind.toUpperCase()}
            </small>
            <strong>{belief.label}</strong>
            <p>{belief.detail}</p>
          </span>
        </section>
        <section className="confidence-card">
          <span className="inspector-section-label">CURRENT SUPPORT</span>
          <strong>{percent(belief.confidence)}</strong>
          <i>
            <b style={{ width: percent(belief.confidence) }} />
          </i>
          <small>Status: {belief.status}</small>
        </section>
        <section className="inspector-section">
          <span className="inspector-section-label">ATMS ENVIRONMENTS</span>
          <div className="environment-list">
            {belief.environments.map((environment, index) => {
              const survives = belief.survivingEnvironments.some(
                (item) => item.join('|') === environment.join('|'),
              );
              return (
                <div
                  key={`${index}-${environment.join('-')}`}
                  className={survives ? 'survives' : 'is-nogood'}
                >
                  <span>
                    {survives ? <CheckCircle2 size={13} /> : <AlertOctagon size={13} />}
                    {survives ? 'SURVIVES' : 'NOGOOD'}
                  </span>
                  <div>
                    {environment.length ? (
                      environment.map((id) => (
                        <button
                          key={id}
                          onClick={() => onSelect({ type: 'assumption', id })}
                        >
                          {id}
                        </button>
                      ))
                    ) : (
                      <em>No assumptions</em>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        <section className="inspector-section">
          <span className="inspector-section-label">JUSTIFICATIONS</span>
          <div className="linked-record-list">
            {incoming.map((edge) => (
              <button
                key={edge.id}
                onClick={() => onSelect({ type: 'belief-edge', id: edge.id })}
              >
                <span>
                  {edge.sourceId} {edge.predicate}
                </span>
                <strong>{percent(edge.weight)}</strong>
                <ArrowDown size={12} />
              </button>
            ))}
          </div>
        </section>
        <LinkedRecords
          title="DIRECT SOURCES"
          ids={belief.sourceIds}
          state={state}
          onSelect={onSelect}
        />
      </>
    );
  }

  const edge = state.beliefEdges.find((item) => item.id === selection.id);
  if (!edge) return <MissingRecord id={selection.id} />;
  return (
    <>
      <section className="belief-edge-card">
        <Link2 size={22} />
        <span>
          <small>{edge.id}</small>
          <strong>
            {edge.sourceId} {edge.predicate} {edge.targetId}
          </strong>
          <p>Weight contribution: {percent(edge.weight)}</p>
        </span>
      </section>
      <div className="dependency-arrow">
        <button
          onClick={() => {
            const next = selectionForId(state, edge.sourceId);
            if (next) onSelect(next);
          }}
        >
          {edge.sourceId}
        </button>
        <ArrowDown size={18} />
        <button
          onClick={() => {
            const next = selectionForId(state, edge.targetId);
            if (next) onSelect(next);
          }}
        >
          {edge.targetId}
        </button>
      </div>
      <LinkedRecords
        title="SOURCE ARTIFACTS"
        ids={edge.sourceEvidenceIds}
        state={state}
        onSelect={onSelect}
      />
    </>
  );
}

function ContributionList({
  title,
  items,
  state,
  onSelect,
}: {
  title: string;
  items: CaseState['worldEdges'][number]['contributions'];
  state: CaseState;
  onSelect: (selection: Selection) => void;
}) {
  return (
    <section className={`contribution-section contribution-${title.toLowerCase()}`}>
      <span className="inspector-section-label">{title}</span>
      {items.length ? (
        <div className="contribution-list">
          {items.map((item) => {
            const next = selectionForId(state, item.sourceId);
            return (
              <button
                key={`${item.sourceId}-${item.label}`}
                disabled={!next}
                onClick={() => next && onSelect(next)}
              >
                <span>
                  {item.label}
                  <small>{item.sourceId}</small>
                </span>
                <strong>
                  {item.polarity === 'oppose' ? '−' : '+'}
                  {Math.round(item.weight * 100)}%
                </strong>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="muted-copy">No contributions recorded.</p>
      )}
    </section>
  );
}

function LinkedRecords({
  title,
  ids,
  state,
  onSelect,
}: {
  title: string;
  ids: string[];
  state: CaseState;
  onSelect: (selection: Selection) => void;
}) {
  if (!ids.length) return null;
  return (
    <section className="inspector-section">
      <span className="inspector-section-label">{title}</span>
      <div className="source-chip-list">
        {ids.map((id) => {
          const next = selectionForId(state, id);
          return (
            <button key={id} disabled={!next} onClick={() => next && onSelect(next)}>
              <Link2 size={11} /> {id}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function MissingRecord({ id }: { id: string }) {
  return (
    <section className="adapter-warning">
      <AlertOctagon size={18} />
      <div>
        <strong>Record unavailable</strong>
        <p>{id} is not present in this case revision.</p>
      </div>
    </section>
  );
}
