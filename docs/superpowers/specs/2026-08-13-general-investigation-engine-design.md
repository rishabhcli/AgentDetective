# THREAD: general investigation engine

Date: 2026-08-13
Status: approved by delegation (owner granted full autonomy for a fixed
four-hour build; no blocking questions permitted)

## Problem

THREAD reasons well about exactly one case. Everything that makes the product
legible — entities, world relationships, competing reconstructions, ranked
anomalies — exists only inside the hand-authored Badge 17 fixture.

Three specific couplings prove it:

1. `investigateAnomaly` branches on the literal anomaly `AN-J` and reaches for
   the literal reference `U-J`. Every other anomaly falls through to a generic
   "recovered N linked sources" path that changes no belief.
2. `applyCounterEvidence` is a scripted transition. It hardcodes `EV-143`,
   `A-19`, `R-A`, `R-C`, `WE-VEHICLE-WAREHOUSE` and the exact coverage numbers
   the demo should land on.
3. `ingestLocalEvidence` ends by recording, truthfully, that "No entity merge,
   event, or world edge was created automatically." Uploading real files into a
   fresh case produces artifacts, observations and claims — and then stops.

The LangGraph orchestrator does not close this gap. Its seven nodes emit an
`AgentRunStep` each and compute nothing; the state change happens in
`reasoning.ts` before `run()` is ever called. The run ledger is honest about
what it did, which is: bookkeeping.

Consequence: a new case is an empty graph forever. "Throw any challenge at it"
is currently false in the most basic sense.

## Goal

Derive, from arbitrary observations and claims, the same structures the fixture
supplies by hand — and derive them defensibly, so that every produced edge,
belief and reconstruction statement carries the provenance the UI already knows
how to display.

Non-goal: making the engine cleverer than its evidence. An empty case must
produce an empty graph, and a thin case must produce a visibly thin graph with
its silences named. Fabrication is a worse failure than sparseness.

## The binding constraints

`AGENTS.md` governs and does not bend for this work:

- An artifact saying something creates a claim, never a world fact.
- Uncertain references stay `UnresolvedReference` records with candidate
  bindings. No hard merges for convenience.
- Extraction confidence stays separate from Admiralty source reliability (A–F)
  and information credibility (1–6).
- Vague time is an interval. No invented precision.
- Every reconstruction statement is labeled `SUPPORTED`,
  `PARTIALLY_SUPPORTED`, `INFERRED`, `DISPUTED` or `UNKNOWN`.
- No guilt verdict, ever. This is decision support.

One rule is added by this design:

- **Derived structures declare themselves.** Anything the engine infers rather
  than reads is attributable to the inference pass that produced it and can be
  recomputed or withdrawn. A derived edge is not dressed up as an observed one.

## Architecture

A new pure module, `packages/domain/src/inference.ts`, sitting beside
`reasoning.ts` (which mutates state) and `deduction.ts` (which only reads it).
`inference.ts` is a _deriving_ layer: state in, proposed additions out. It
never persists and never mutates its input.

```
observations + claims
        │
        ▼
  1. mention extraction      → EntityMention[]
        │
        ▼
  2. identity resolution     → Entity[] + UnresolvedReference[]
        │                       (candidate bindings; no merges)
        ▼
  3. temporal derivation     → TemporalConstraint[]
        │                       (Allen path consistency)
        ▼
  4. relationship derivation → WorldEdge[] + Assumption[]
        │                       (each edge names the leap it required)
        ▼
  5. contradiction detection → Belief[] (contradiction) + nogoods
        │
        ▼
  6. abduction               → Belief[] (hypothesis, alternative-explanation)
        │
        ▼
  7. reconstruction          → Reconstruction[] with labeled statements
        │
        ▼
  8. question ranking        → Anomaly[] ordered by expected information gain
```

Stages 3, 5, 7 and 8 reuse machinery that already exists and is already tested:
`enforceTemporalPathConsistency`, `propagateNogood`, `computeWeightedCoverage`,
`rankQuestionsByInformationGain`, `admiraltyStrength`, `scoreCandidateBindings`.
The new work is stages 1, 2, 4 and 6, plus the pass that composes them.

### Stage contracts

Each stage is a separate exported function taking explicit inputs and returning
proposed records — not a method on a pipeline object. That keeps every stage
independently testable and lets the orchestrator run a subset.

- `extractEntityMentions(observations, claims)` — surface forms with the
  locator that produced them and a kind distribution. Recognizes people
  (speakers, capitalized name runs), times, places, organizations, and
  identifier-shaped objects (plates, badges, emails, phones, accounts). Emits a
  mention, not an entity: a mention is a thing said, and several mentions may
  turn out to be one entity or none.
- `resolveEntities(mentions, existing)` — clusters mentions into candidate
  entities on lexical, contact, temporal and co-occurrence channels. Anything
  below the confidence floor becomes an `UnresolvedReference` with scored
  candidate bindings instead of an entity.
- `deriveTemporalConstraints(observations, entities)` — pairwise Allen
  constraints between interval-bearing records, then path consistency. An
  inconsistent network is reported, not silently repaired.
- `deriveWorldEdges(state, entities, mentions)` — co-occurrence and
  predicate-shaped relationships, each carrying its source observation/claim
  IDs, weighted contributions, and an explicit `Assumption` for every leap the
  derivation required.
- `detectContradictions(state)` — claim-vs-claim, claim-vs-observation, and
  edge-vs-edge conflicts, including the same speaker asserting incompatible
  intervals.
- `abduceHypotheses(state)` — competing explanations ranked by what share of
  material weight each explains, with the alternatives retained rather than
  collapsed.
- `buildReconstructions(state, hypotheses)` — narrative accounts whose every
  statement carries a support label computed from its sources.
- `rankOpenQuestions(state)` — anomalies ordered by expected information gain
  over the live hypothesis distribution.
- `runInferencePass(state, options)` — composes the above into a
  `MutationResult`, so it lands on the existing mutation pipeline unchanged.

## Data flow into the existing system

`runInferencePass` returns `MutationResult`, which is exactly what the routes
in `app.ts` already consume. No route learns a new shape:

1. Route loads `CaseState`.
2. Route calls the pure function.
3. `revision === null` still means no-op.
4. Route persists, builds a packet, attaches an `AgentRun`.

The ingestion route gains one line: after `ingestLocalEvidence` succeeds, run
the inference pass over the resulting state. The orchestrator's nodes stop
being decorative and call the matching stage.

## Error handling

A stage that cannot produce anything returns an empty array — that is a
legitimate result and the case shows as thin. A stage that throws is caught by
the composing pass, which records a `failed` step naming the stage and
continues with the remaining stages; a parser fault must not cost the user the
whole pass. This mirrors the existing fix where an `exifr` fault aborted the
entire image branch.

Budgets: the pass is bounded by observation count and pair count so a large
corpus degrades to sampling rather than quadratic blowup, and the bound taken
is recorded on the run.

## Testing

Unit tests per stage in `packages/domain/src/inference.test.ts`, written first:

- Empty case yields empty derivations and no revision.
- A two-artifact case where one speaker contradicts another yields exactly one
  contradiction belief and no world fact for the disputed proposition.
- A vague reference ("someone", "there") never becomes an entity.
- Two mentions of the same name with different supporting channels produce one
  candidate entity with alternatives retained, not a merge.
- An inconsistent interval network is reported inconsistent.
- Reconstruction statements are never labeled `SUPPORTED` without at least one
  corroborating observation.
- Derived output is deterministic: same input, same IDs, same order.

Then the existing gates: `format:check`, `lint`, `typecheck`, `test`, `build`,
`test:e2e`.

## Sequencing

1. Inference engine, TDD, no wiring. (This spec.)
2. Case lifecycle: create/list/delete, multi-case stores, ingestion wiring.
3. Orchestrator nodes call real stages; planner selects; critic evaluates.
4. Adversarial reasoning; generalize `applyCounterEvidence` so any artifact can
   invalidate any assumption.
5. Web surface for arbitrary cases, budgets, full validation.

Fixture IDs (`EV-143`, `A-19`, `AN-J`, `R-C`, `case-badge-17`) stay stable
throughout. The Badge 17 demo must still pass its Playwright spec unchanged
when this is done — the fixture becomes one case the general engine can hold,
not the only case it understands.
