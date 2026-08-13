# THREAD

**A living reconstruction of what happened.**

THREAD is an evidence-to-world-model engine for inspecting what a source
contains, what may have happened, and what the current competing explanations
depend on. It is not a detective chatbot and never emits a guilt verdict.

> Every string on the board must mean something.

The repository implements the product in `human_readable_plan.md` and the
technical decisions in the Compass research dossier as a runnable, honest local
development system. Two bundled cases make the evidence boundary explicit:

- **The Badge 17 discrepancy** is controlled synthetic data for repeatable cascades.
- **The missing sponsor prize** is a privacy-safe derivative of a real,
  user-authorized Aside investigation. Names, private wording, handles, and raw
  locators are intentionally not bundled.

## What is concrete today

- one zoomable evidence canvas projected from normalized Evidence, World, and
  Belief state; the board opens locked, can be explicitly unlocked for freeform
  move/resize, and persists one layout per case
- textured evidence cards, pins, layered rope strings, and hover/focus briefs
  that explain both what a source contains and why it touches the case
- immutable source artifacts with SHA-256, typed observations, verbatim claims,
  locators, hedges, and unresolved references
- independent Admiralty A–F source reliability and 1–6 information credibility
- candidate identity bindings rather than hard merges
- event-centered edges with valid/transaction time, supporting/opposing
  contributions, alternatives, assumptions, and clickable provenance
- competing reconstructions with weighted coverage and sentence-level support
- ATMS-lite nogood propagation, 13 Allen relations plus path consistency, and
  entropy/expected-information-gain question ranking
- four memory collections: world, evidence, belief, and procedural
- bounded case packets assembled with Atlas Search + Vector Search +
  `$rankFusion`, then expanded by `$graphLookup`
- explicit LangGraph transforms—INGESTOR through INVESTIGATOR—with MongoDB
  checkpoints and visible selected/skipped supersteps
- persisted case-research sessions that keep the answer, findings, source trail,
  checked-empty surfaces, corrections, limitations, next questions, packet, and
  run ID together
- durable outcome-oriented missions that write their plan before acting, recover
  prior work, investigate the highest-information question when asked, challenge
  the leading account, and persist the mission, packet, session, and run together
- standing orders created from natural-language monitoring instructions; every
  new artifact triggers a persisted relevance check rather than a fake timer or
  background animation
- real `What changed?` state revisions and an affected-subgraph counter-evidence
  cascade
- live OpenRouter hypothesis/falsifier calls from different model families
- live ElevenLabs Scribe v2 transcription and a signed voice interview room
- schema-validated Fireworks visual extraction when provider inference is active;
  deterministic EXIF/OCR or an honest unprocessed marker otherwise
- a mystery-first **The Agentic Detective.** landing page with near-black
  cinematic atmosphere, a reconstructed 51-second discrepancy, tactile generated
  cork, pinned paper, photographs, stickies, and reduced-motion fallbacks
- a case-specific four-step opening that explains the actual question, card
  types, inspectable strings, and mission flow before the user reaches the board
- one cohesive near-black, warm-ivory, evidence-red visual system across landing,
  case opening, canvas, and agent conversation, with operational text kept at a
  readable size rather than compressed into dashboard microcopy
- an original ImageGen THREAD mark plus a 12-icon evidence library used by the
  case guide and live board cards; generation notes and source sheets live in
  `apps/web/public/brand/IMAGEGEN_ASSETS.md`
- a compact Liquid Glass control island using real `metal-fx`, `border-beam`,
  and `thinking-orbs` interactions rather than a dashboard tab bar
- a permanent right-side research console with a Beam-style composer, real
  server-sent progress, natural-language missions, inspectable source IDs,
  negative-space reporting, follow-up threads, a detailed Run Ledger, and one
  honest orb state for each case agent
- an optional PTY-backed Aside adapter for explicit **Connected** searches over
  relevant browser history, public pages, and already-authenticated surfaces;
  its runtime contract is observe-only, and its located results remain leads
  until their source artifacts are preserved through normal ingestion
- uploaded image artifacts rendered back on the private case canvas from their
  preserved source bytes; non-image uploads remain clearly typed source cards
- preserve-first intake for any file up to 100 MB: recognized containers receive
  bounded extraction, while unknown binaries remain immutable `requires-adapter`
  artifacts instead of being rejected or described with fabricated content
- an in-app ingestion receipt driven by the completed API response—not a timer—
  with artifact ID, observation/claim counts, extraction path, warnings, source
  inspection, and the actual revision trace
- rare, persisted clarification prompts only for hard container/category
  conflicts; the original is already preserved, standard answers are MCQ, and
  the custom field stays hidden unless **Something else** is explicitly chosen
- five guided demo scenarios that execute the real engine, gate themselves on
  live adapter state, and refuse to re-run work the case already records
- deduction chains that separate what was observed from what was merely
  attested, name the leap between them, mark the limiting step, and state the
  finding that would collapse the conclusion
- keystone analysis ranking which single assumption would take the most of the
  case with it, and evidential silences naming what is _not_ there

## Runtime split

Only **Atlas Local** runs as local infrastructure. All sponsor adapters call the
real remote service and are reported from live verification—never inferred from
the presence of a key.

| Capability                                                 | Runtime                             | Current local-machine evidence                                                                                        |
| ---------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| MongoDB / Search / Vector / `$rankFusion` / `$graphLookup` | Atlas Local Docker                  | Live and queryable                                                                                                    |
| embeddings                                                 | on-device `Xenova/all-MiniLM-L6-v2` | 384 dimensions, cached locally                                                                                        |
| LangGraph checkpointing                                    | Atlas Local MongoDBSaver            | Live checkpoint collections                                                                                           |
| OpenRouter                                                 | remote API                          | Live credential and structured calls exercised                                                                        |
| ElevenLabs                                                 | remote API                          | Live agent and signed URL exercised                                                                                   |
| Fireworks                                                  | remote API                          | Live schema-validated visual extraction exercised on an uploaded frame                                                |
| Aside connected research                                   | signed-in local browser application | Live read-only public-web structured handoff exercised; private connected-app sweep remains unverified through THREAD |

Provider state is always read from a live probe. Fireworks verification checks
that the configured model is actually present in the serverless catalog and
accepts image input, because a valid credential alone still fails at inference
time with a 404 for a model that was never deployed. When a provider is not
active, image uploads still preserve the original and fall back to deterministic
EXIF/OCR without inventing visual facts.

## Quick start

Requirements:

- Node.js 24+
- pnpm 11+
- Docker Desktop

```bash
pnpm install
cp .env.example .env   # skip this if .env already contains sponsor credentials
pnpm atlas:up
pnpm dev
```

Open <http://127.0.0.1:5173>. The API is at
<http://127.0.0.1:8787> and Atlas Local listens only on
`127.0.0.1:27017`.

Useful runtime checks:

```bash
pnpm atlas:check
curl -s http://127.0.0.1:8787/api/health | jq
docker exec thread-atlas-local mongosh --quiet thread \
  --eval 'db.langgraph_checkpoints.countDocuments()'
```

## Useful commands

```bash
pnpm dev:local       # start/health-check Atlas, then API + web
pnpm atlas:up        # start pinned Atlas Local container
pnpm atlas:down      # stop it without deleting named volumes
pnpm atlas:logs      # follow MongoDB/mongot logs
pnpm dev             # API + web watchers (Atlas already running)
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

## Architecture

```text
apps/web       React/Vite kinetic landing, React Flow evidence canvas,
               integrated case-agent conversation, focused live drawers
apps/api       Express, provider hub, multimodal ingestion, Atlas store,
               bounded retrieval, LangGraph orchestration
packages/domain
               shared types, deterministic reasoning, synthetic and real-redacted cases
compose.yaml   pinned Atlas Local image, loopback port, durable volumes
```

### Persistent model

Atlas stores each domain family separately: evidence, observations, claims,
entities, world edges, unresolved references, assumptions, beliefs, belief
edges, reconstructions, anomalies, all four memories, case packets, research
sessions, agent missions, standing orders, agent runs, temporal constraints, and
revisions. Every saved snapshot embeds observations locally for Vector Search.
Search indexes are created and awaited at startup.

### Agent missions

`POST /api/cases/:caseId/missions/stream` accepts an outcome-oriented
`instruction` and emits newline-delimited progress from actual completed stages.
The JSON equivalent is `POST /api/cases/:caseId/missions`. A mission is durable:
its plan is saved before the first transform, and each capability records inputs,
outputs, timestamps, and status. Instructions such as “monitor…” create a
standing order for future evidence. Requests to send, post, pay, edit, or submit
finish as `waiting-for-review` when only the read-only connected adapter is
available; THREAD never relabels research as an external action.

Every successful evidence upload also records an intake mission showing that the
original was preserved first, the case packet was re-ranked, and the next useful
question was left visible.

### Natural-language case research

`POST /api/cases/:caseId/research/stream` emits newline-delimited progress only
when each real stage starts or completes. The run recovers useful procedural
memory, builds an Atlas rank-fusion packet, expands graph neighbors, compares
time intervals, produces an OpenRouter hypothesis/falsifier review when live (or
continues through the deterministic local path), records what the search did not
establish, checkpoints the selected LangGraph transforms, and persists the
result as procedural and belief memory.

The composer has two explicit scopes:

- **Case file** is always available and never depends on a remote model.
- **Connected** is enabled only when `THREAD_CONNECTED_RESEARCH=aside` and a
  signed-in local Aside profile passes the live health probe. The adapter runs
  Aside inside a genuine PTY with a bounded runtime/output budget and a hard
  read-only task contract. Browser locators are not evidence; preserving a
  source is a separate ingestion action.

### Bounded agent execution

Agents never receive the whole case. A task builds a case packet with exact and
semantic matches, two-hop graph neighbors, and useful previous strategies. The
LangGraph chain records which of the seven transformations were selected or
skipped and persists each superstep with a unique case/run thread ID. The UI
exposes packet counts, model/provider, affected object IDs, and checkpoint ID.

### Evidence ingestion

The API accepts one artifact of any file type up to 100 MB and preserves its
bytes plus SHA-256 before extraction. The intake UI accepts drag-and-drop or file
selection, fills safe source defaults, and infers only the artifact container.

- text/CSV/JSON/log/calendar: bounded UTF-8 decode
- PDF: local page text extraction
- DOCX: local raw-text extraction
- EML: headers plus body with source structure
- ZIP: bounded member inventory and safe text members
- image: EXIF, live Fireworks structured observations when ready, then local OCR
- audio/video: live ElevenLabs Scribe v2 transcript with case keyterms

No intake path creates an entity merge or world edge automatically. A binary
that cannot be interpreted remains `requires-adapter` and still produces a real
receipt. Normal ambiguity never interrupts intake. Only a hard mismatch—such as
an image submitted as audio—creates a persisted clarification. THREAD continues
processing before asking, offers bounded MCQ choices, and records the answer as
procedural context without rewriting the artifact. An unanswered prompt survives
reload; the free-form field appears only after choosing **Something else**.

## Core demonstration

Opening either case from the landing page first presents a four-step guide
in plain language. It establishes that the board separates sources, candidate
entities, questions, and reconstructions; that every string is an inspectable
argument; and that agent output remains belief memory. Returning users can deep
link to `/#case` for Badge 17 or
`/#case=case-sponsor-prize-dispute` for the anonymized real investigation.

**Guided scenarios** in **More case actions** opens five guided runs. Each one
states the question it answers, what it proves, and which runtime it exercises,
then performs the same request as its equivalent integrated control—there are no
replays or scripted timings. A scenario whose adapter is not live disables
itself and shows the live reason instead of failing midway, and a scenario the
case already records reports that rather than pretending to run again.

The same ground can be covered manually:

1. Unlock the board, move or resize a pinned card, then inspect a string to see its sources,
   support, opposition, assumptions, and uncertainty.
2. Open an immutable evidence card or an unresolved question without leaving the
   shared board.
3. Investigate **Who is “J”?** and watch the pinned question plus integrated
   agent trace update only after the Atlas packet is checkpointed.
4. Introduce Evidence 143. It invalidates assumption A-19, removes dependent ATMS
   environments, changes edge confidence, and flips the leading reconstruction.
5. Open **What changed?** for the evidence → assumption → event → belief trace.
6. Ask the research console a natural-language question and follow the real
   context → retrieval → challenge → checkpoint stages as they stream.
7. Inspect **What survived**, the exact **Source trail**, and **Checked, not
   established**, then follow one of the ranked next questions.
8. When the Aside health row is ready, switch to **Connected** for an explicit
   read-only sweep. Its locators remain leads until preserved as artifacts.
9. Open **Interview** for the signed ElevenLabs witness room.

For the real case, open **The missing sponsor prize**. The imported Aside mission
shows exactly which signed-in and public surfaces were checked, the clean
negative that weakened the insider-routing theory, the party claims that remain
attributed, and the absent submission/prize records that would resolve the case.
It is not pre-aligned to a culprit or a predetermined answer.

## Environment and secrets

`.env.example` lists every setting. The actual `.env` is gitignored and must
remain server-only. Do not expose provider keys through Vite/client variables.
`THREAD_CONNECTED_RESEARCH=aside` opts this machine into the local signed-in
Aside profile; leaving it blank keeps the Connected control disabled while the
case-file engine remains fully usable.

## Validation

Run sequentially before a handoff:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Browser coverage is 72 Playwright tests across nine specs:

| Spec                 | Covers                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `thread.spec.ts`     | critical board → provenance → investigation → cascade → upload → reset flow                                               |
| `landing.spec.ts`    | animated narrative, four-step case opening, unified theme, readable type, integrated composer, seven orbs, phone overflow |
| `ingestion.spec.ts`  | arbitrary binary preservation, live processing receipt, rare MCQ clarification, custom-answer gating, reload persistence  |
| `lenses.spec.ts`     | movable/resizable cards, semantic strings, provenance, live board transforms                                              |
| `dialogs.spec.ts`    | modal contract for seven focused surfaces; integrated conversation is not modal                                           |
| `deduction.spec.ts`  | observed/attested reasoning rungs, limiting steps, keystones, silences                                                    |
| `responsive.spec.ts` | eight viewports, board/agent switching, reduced motion, keyboard, names                                                   |
| `scenarios.spec.ts`  | guided scenarios, live availability gating, persisted execution traces                                                    |
| `research.spec.ts`   | integrated answer, source trail, negative-space ledger, inspectable IDs, and connected read-only boundary                 |

See `IMPLEMENTATION_STATUS.md` for the evidence boundary and
`LAUNCH_CHECKLIST.md` for the publication work.

## Safety

THREAD is decision support, not admissible evidence. It performs no facial
recognition, silently upgraded certainty, or automatic guilt assignment.
