# THREAD repository instructions

These instructions apply to the entire repository.

## Mission

Build **THREAD**, an evidence-to-world-model engine. The product is not a
detective chatbot and must never present an AI-generated guilt verdict. It
turns raw evidence into inspectable observations, claims, candidate entities,
events, relationships, competing reconstructions, and investigative questions.

The core promise is:

> Every string on the board must mean something.

Every relationship shown in the interface must expose its sources, supporting
and opposing contributions, uncertainty, assumptions, and invalidation path.

## Source of truth

Read these files before changing product behavior:

1. `human_readable_plan.md` — product model, interactions, and narrative.
2. `compass_artifact_wf-a016a346-bc57-5dcc-913d-95b05149874a_text_markdown.md`
   — technical research and implementation recommendations.
3. `README.md` — implemented scope, architecture, setup, and validation.

When the research dossier describes a remote capability that is not configured
locally, implement an honest adapter boundary and a deterministic local path.
Never fabricate a network response, model result, transcript, database status,
or agent run.

## Non-negotiable modeling rules

- Evidence artifacts are immutable. Corrections create a new revision or an
  explicit challenge; they do not rewrite source material.
- An artifact saying something creates a **claim**, not a world fact.
- Extracted observations retain their source artifact and exact locator.
- Uncertain references remain `UnresolvedReference` records with candidate
  bindings; do not hard-merge them for convenience.
- Identity resolution uses candidate links before confirmed links.
- Keep extraction confidence separate from evidentiary strength. Evidentiary
  strength retains independent Admiralty source-reliability (A-F) and
  information-credibility (1-6) ratings.
- World relationships retain sources, confidence, valid time, transaction time,
  disputes, alternatives, and creating agent.
- Beliefs retain assumptions and justification edges. Invalidating an
  assumption must cascade through dependent hypotheses and reconstructions.
- Time is represented as an interval when the source is vague. Do not invent
  precise timestamps.
- Reconstructions label every statement as `SUPPORTED`,
  `PARTIALLY_SUPPORTED`, `INFERRED`, `DISPUTED`, or `UNKNOWN`.
- Never output or imply a guilt verdict. This is decision support, not
  admissible evidence.

## Repository shape

```text
apps/
  api/       HTTP API, storage adapters, ingestion endpoints
  web/       React investigation workspace
packages/
  domain/    shared case types, deterministic reasoning, sample case
tests/       end-to-end and repository-level checks
```

Do not duplicate domain types inside apps. UI projections must derive from the
same case state rather than maintaining disconnected mock datasets.

## Required toolchain

- Node.js 24 or newer
- pnpm 11 or newer

Install and run:

```bash
pnpm install
pnpm dev
```

The web app is served at `http://127.0.0.1:5173`; the API is served at
`http://127.0.0.1:8787`.

Validation before handoff:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Run lifecycle commands sequentially. Do not claim a flow works because only the
build or health endpoint passed.

## Runtime modes and truthfulness

The intended development split is strict: **Atlas Local is the only local
infrastructure service.** It runs in Docker on loopback and provides MongoDB 8,
Search, Vector Search, rank fusion, graph lookup, change streams, normalized
memory collections, and LangGraph checkpoints. The on-device MiniLM embedding
model is a local application dependency, not a simulated sponsor API.

The JSON adapter exists only as a credential-free test/degraded fallback. Do not
describe it as the primary dev runtime while `MONGODB_URI` points at Atlas Local.

Sponsor adapters are real remote calls configured in server-only `.env` values:

- Fireworks for schema-validated visual observation extraction
- OpenRouter for diverse hypothesis/falsification model families
- ElevenLabs for Scribe v2 transcription and signed witness interview sessions

`/api/health` is authoritative. Distinguish `ready`, `degraded`, `blocked`, and
`unconfigured`; a key being present does not prove inference access.

If an adapter is absent or unhealthy, show it as unavailable and keep its action
disabled or use the explicitly labeled local engine. Never display fake
"connected", fake streaming, fake agent reasoning, or arbitrary timers.

## UI direction

Use a restrained forensic-dossier aesthetic: near-black ink, warm paper,
oxidized brass, evidence red, mono metadata, and an editorial serif narrative.
The interface should feel like a serious investigative instrument, not a game
and not a generic dashboard.

Required interaction principles:

- The Evidence, World, and Belief graphs are distinct linked projections.
- Graph edges are keyboard accessible and open a provenance inspector.
- Uncertainty is encoded redundantly: label, opacity, stroke width, and dash.
- People, Time, Place, Objects, Evidence, and Theory are lenses over one state.
- The anomaly queue and `Investigate` action must execute real deterministic
  case analysis, build a bounded case packet, and persist a LangGraph run.
- The manila runtime ribbon and Run Ledger must show actual provider state,
  packet method, affected IDs, selected/skipped agents, and checkpoint ID.
- Model reviews are stored as belief memory, never evidence or world facts.
- `What changed?` must compare actual case-state revisions and trace a changed
  reconstruction through evidence, assumptions, events, and beliefs.
- Respect `prefers-reduced-motion`; never rely on color alone.
- Avoid ornamental red strings that do not correspond to domain edges.

## Code quality

- TypeScript runs in strict mode. Avoid `any`; validate API inputs at runtime.
- Keep reasoning functions pure and cover them with focused tests.
- Store timestamps as ISO-8601 strings and percentages internally as `0..1`.
- Use stable IDs in fixtures so provenance links and screenshots are repeatable.
- Make controls perform their named action. No dead buttons or placeholder
  navigation in the main experience.
- Keep demo/sample evidence clearly labeled as synthetic.
- Preserve user-created case data when changing schemas; add migrations when
  persistence formats change.

## Definition of done

A change is not complete until the relevant unit tests pass, the production
bundle builds, the API health and state routes respond, and the affected browser
flow has been exercised at both desktop and narrow viewport widths. Report any
remote integration not exercised as unverified rather than implying it passed.

## Local launch sequence

```bash
pnpm install
cp .env.example .env   # never overwrite an existing credentialed .env
pnpm atlas:up
pnpm dev
```

The first Atlas startup can pull a large image and the first embedding save can
populate `.thread-cache/`. Wait for `docker compose ps` to report healthy.
