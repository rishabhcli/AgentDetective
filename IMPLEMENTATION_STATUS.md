# THREAD implementation status

Updated: 2026-08-13 (local development machine)

This is an evidence-bound handoff, not a feature wish list. “Live” means the
capability was exercised on this machine; it does not prove public deployment.

## The general derivation engine (added 2026-08-13, later session)

THREAD previously reasoned about exactly one case. Entities, relationships,
competing accounts and ranked questions existed only inside the hand-authored
Badge 17 fixture: `investigateAnomaly` branched on the literal anomaly `AN-J`,
`applyCounterEvidence` was a scripted transition over `EV-143`/`A-19`/`R-A`/`R-C`,
and `ingestLocalEvidence` ended by recording that no entity, event or world edge
had been created. A new case stayed an empty graph.

`packages/domain/src/inference.ts` is a pure deriving layer that closes that
gap. Exercised on this machine:

| Capability               | Evidence boundary                                                                                                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mention extraction       | Speakers, capitalized name runs, identifier shapes and locative phrases read from arbitrary observations and claims, each bound to the record and locator that produced it                               |
| Identity resolution      | Mentions clustered without hard merges; vague forms stay unresolved; a partial name becomes candidate bindings with open-world mass reserved                                                             |
| Temporal placement       | Intervals read from timestamps sources already carry, including a leading timestamp that line-level quoting drops; a bare clock with no date anchor stays null                                           |
| Relationship derivation  | Co-occurrence turned into provenance-bound edges; testimony scored through its Admiralty rating; every edge carries an explicit assumption naming its leap                                               |
| Contradiction detection  | Overlapping placements, placements too close to travel between under a stated transit warrant, and one artifact denying another                                                                          |
| Abduction                | A contradiction answered with the competing explanations that would dissolve it; none selected                                                                                                           |
| Reconstruction           | Competing accounts whose every statement carries a support label computed from its own sources                                                                                                           |
| Question ranking         | Anomalies ordered by expected information gain over the live distribution                                                                                                                                |
| Stage reporting + critic | One report per agent (completed / skipped with reason / failed) driving the run ledger, plus `assessDerivation` grading the pass by exposure                                                             |
| General investigation    | `Investigate` rescores identities, weighs contradictions by corroboration, and searches for corroboration of lone relationships — recording refusals as results                                          |
| General cascade          | `challengeAssumption` invalidates any warrant in any case and propagates through ATMS environments, dependent edges and derived accounts                                                                 |
| Case lifecycle           | `POST /api/cases`, `DELETE /api/cases/:caseId` (bundled fixtures refused), `POST /api/cases/:caseId/infer`, and the web controls for all three                                                           |
| Coreference              | Pronouns resolved to a single unambiguous antecedent within an artifact; two candidates stay two candidates, and the resolution never consults the pronoun's form                                        |
| Source reliability       | Every artifact carries an explicit `A-SOURCE-<id>` warrant, so discrediting one source withdraws exactly its footprint through the same cascade and leaves the rest standing                             |
| Browser proof            | `tests/newcase.spec.ts` opens an empty case, preserves ordinary text files, and asserts participants, relationships, contradictions, competing accounts, the assumption cascade, and source discrediting |

Test counts after this work: 147 domain, 30 API, 1 web component, and the
Playwright suite (5 skipped, all provider-gated) including five new specs that
involve no fixture.

### What this session did _not_ exercise

This matters more than the table above. **No `.env` and no Atlas container were
present during this work, so every run above used the credential-free JSON
store.** Specifically not exercised here:

- `MongoCaseStore.deleteCase` is written but never run.
- LangGraph checkpointing never ran; without `MONGODB_URI` the orchestrator
  returns an uncheckpointed run with a null checkpoint ID, which is the path
  these runs took.
- `$rankFusion` / `$vectorSearch` retrieval never ran; every packet in these
  runs came from the bounded lexical fallback.
- No provider (Fireworks, OpenRouter, ElevenLabs, Aside) was contacted.

The Atlas, embedding, rank-fusion and provider rows in the older table below
were verified in an earlier session and **predate the derivation engine**. They
should be re-run against Atlas before any of them is described as current.

No new top-level `CaseState` array was introduced, so `collectionMap` and
`normalizeCaseState` need no migration; the derived records land in arrays that
already persist.

### Follow-ups this work leaves behind

- `packages/domain/src/inference.ts` is now roughly 2,900 lines. Every export
  appears once and each stage is separately tested, but the file is doing enough
  that it should be split into a directory module. Deliberately not done at the
  end of a session with no time to re-validate a mechanical move of that size.
- `assessDerivation` (inference) and `findEvidentialSilences` (deduction) both
  report single-source relationships and unresolved identities. They serve
  different callers — the run ledger and the deduction drawer — but the overlap
  is real and should be reconciled rather than left to drift apart.
- `assessDerivation`'s concerns reach the audit trail but have no dedicated
  surface in the interface yet.

### Known bounds of the derivation itself

- Mention extraction is lexical and English-shaped. It reads capitalized name
  runs, corporate suffixes, locative prepositions and identifier shapes. It does
  not do morphology, coreference across records, or non-Latin scripts.
- The transit warrant that lets two near-simultaneous placements conflict is a
  stated assumption, not a measurement: the engine holds no map and cannot prove
  two locations are far apart. It is attached to every conflict resting on it so
  it can be invalidated.
- A pass is bounded by record count and degrades to a recorded sample rather
  than doing quadratic work. The bound taken appears in the audit trail.
- Authored reconstructions are never overwritten by derivation, so the Badge 17
  fixture keeps its curated accounts.
- Coreference resolves within one artifact only and refuses whenever more than
  one antecedent is possible, so it recovers the common single-subject case and
  declines the rest rather than guessing.

## Implemented and exercised (earlier sessions)

| Area                         | Evidence boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Atlas Local                  | Healthy Docker replica set; MongoDB and mongot; loopback-only port                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Normalized persistence       | Case state saved and reloaded from per-domain collections                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Hybrid retrieval             | Search and Vector indexes queryable; `$rankFusion` packets observed after index freshness; bounded fallback remains explicit                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Graph retrieval              | `$graphLookup` probe and neighbor expansion passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Embeddings                   | local MiniLM loaded; 384-dimensional observation vectors saved                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Change streams               | local replica-set stream opened successfully                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| LangGraph                    | seven explicit transforms; MongoDBSaver checkpoint and write documents observed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Deterministic formal methods | candidate binding, ATMS nogoods, Admiralty axes, Allen path consistency, weighted coverage, entropy/EIG tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Ingestion                    | preserve-first intake for any file up to 100 MB; automatic container classification; local text/PDF/DOCX/EML/ZIP/image metadata/OCR paths; unknown binaries retained as `requires-adapter`; response-backed receipt; rare persisted MCQ clarification only for hard file/category conflicts; source-bound claims; no automatic world facts                                                                                                                                                                                                                                                    |
| Fireworks                    | live `inkling` extraction on an uploaded frame; EXIF temporal/GPS observations on the same artifact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| OpenRouter                   | live review through the API; both families schema-valid; output confined to belief memory                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ElevenLabs                   | live Scribe v2 transcript of a recorded statement with hedges retained; signed interview URL with 43 case keyterms                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Aside connected research     | PTY-backed local adapter; signed-in profile readiness probe passed; a real observe-only public-web run returned a schema-valid bounded answer, five checked surfaces, six findings, three negative findings, and an exact public locator without persisting personal data                                                                                                                                                                                                                                                                                                                     |
| Natural-language research    | case-only and connected scopes; real NDJSON progress; Atlas packet and relationship-orbit retrieval; independent challenge; persisted `CaseResearchSession`, belief/procedural memory, and LangGraph run; inspectable sources, checked-empty surfaces, corrections, limitations, and next questions                                                                                                                                                                                                                                                                                           |
| UI                           | mystery-first **The Agentic Detective.** landing with darker cinematic atmosphere and a 51-second case contradiction; unified near-black/ivory/red workspace; four-step human-readable case opening; original ImageGen mark and 12-icon evidence library; tactile cork evidence canvas; larger movable/resizable pinned cards; semantic strings; permanent glass-and-metal research console with case/connected scope; response-backed evidence notification with MCQ/custom emergency clarification; MetalFx controls; seven honest ThinkingOrbs; private previews for preserved user images |
| Browser QA                   | 72 Playwright checks passed; desktop 1440×900 live-progress/result review and narrow 390×844 review; research answer, source trail, negative-space ledger, source inspection, case/connected scope, responsive switching, and all prior case flows exercised without browser console errors                                                                                                                                                                                                                                                                                                   |

## Resolved: the Fireworks blocker was two separate faults

The account reports `suspendState: UNSUSPENDED` and the serverless catalog now
returns HTTP 200, so the billing problem is gone. Two real defects were hiding
behind it:

1. `FIREWORKS_VISION_MODEL` pointed at `qwen3-vl-8b-instruct`, which is not in
   the 19-model serverless catalog. Inference returned `404 Model not found`
   while the credential-only probe kept reporting a healthy key. Verification
   now confirms the configured model is deployed and accepts image input, and
   the default is `accounts/fireworks/models/inkling`.
2. `extraction.ts` imported the CommonJS `exifr` package with a star import, so
   `exifr.parse` was undefined and threw synchronously past its own `.catch`.
   That aborted the entire image branch before any Fireworks call. The import is
   fixed and the metadata step is now isolated, so a decoder fault can no longer
   suppress visual extraction.

Exercised end-to-end on this machine: an uploaded PNG produced six
schema-validated `inkling` observations, and a JPEG carrying real EXIF produced
temporal and GPS observations alongside them.

## Intentionally bounded

- The bundled case and Evidence 143 are synthetic fixtures.
- Change Streams are probed and ready, while the current HTTP mutation path
  directly calculates the affected subgraph; there is no always-on background
  change-stream worker yet.
- LangGraph uses the explicit dependency chain and selected/skipped transforms;
  `Send` fan-out for large multi-artifact batches is not required by the current
  single-file intake surface.
- Video audio is transcribed; visual frame sampling is not yet promoted as a
  separate video-event stream when Fireworks is blocked.
- The witness session is live transport. A conversation is not evidence until a
  recording/transcript is ingested as an immutable artifact.
- The Aside adapter was exercised through a public-web-only request. Its
  authenticated connected-app path is ready and uses the same hard read-only
  contract, but has not been exercised through THREAD in this handoff. Connected
  results are intentionally stored as located leads, not evidence or world facts.
- No public host, public Atlas deployment, production domain, or production CI
  evidence exists yet.

## Ordered next work

1. Put this directory under version control. There is no `.git` here, so every
   line above is unversioned and the checklist's clean-tree/SHA steps cannot run.
2. Connect the hosted MongoDB deployment and re-verify all seven capabilities
   against it rather than local Atlas.
3. Run `LAUNCH_CHECKLIST.md` from a clean shell, including live provider verification.
4. Decide whether the free OpenRouter models are acceptable for a live demo. One
   transient `Provider returned error` was observed during testing; the retry
   path recovered, but a paid model would remove the risk.
5. Add an async change-stream worker and video frame/event extraction after the
   demo if continuous ingestion is needed.
