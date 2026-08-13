# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Product rules come first

`AGENTS.md` holds the binding product and modeling rules for THREAD (evidence
immutability, claims vs. world facts, candidate bindings over hard merges,
separate extraction confidence and Admiralty ratings, no guilt verdicts, no
fabricated provider/runtime state). Read it before changing product behavior;
this file covers only the mechanics of working in the code.

`human_readable_plan.md` (product model) and the Compass research dossier
(`compass_artifact_wf-*.md`) are the upstream specs. `IMPLEMENTATION_STATUS.md`
records what has actually been exercised on this machine — update it rather than
overstating a capability elsewhere.

## Commands

```bash
pnpm install
cp .env.example .env      # never overwrite an existing credentialed .env
pnpm atlas:up             # Atlas Local container (the only local infra service)
pnpm dev                  # api :8787 + web :5173, both bound to 127.0.0.1
pnpm dev:local            # atlas:up, then dev
```

Validation (run sequentially; each is also a separate CI-style gate):

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e
```

Targeted runs:

```bash
pnpm --filter @thread/domain test                     # one workspace's vitest suite
pnpm --filter @thread/domain test -t "nogood"         # one test by name
pnpm --filter @thread/api test src/app.test.ts        # one test file
pnpm --filter @thread/web typecheck                   # one workspace's tsc
pnpm exec playwright test -g "narrow viewport"        # one e2e spec
pnpm exec playwright test --headed --debug
```

`pnpm test:e2e` starts `pnpm dev` itself unless a dev server is already on
:5173 (`reuseExistingServer`), and each spec first calls `POST /api/demo/reset`,
which destroys local case state. Don't run it against data you care about.

Runtime checks: `pnpm atlas:check`, `curl -s http://127.0.0.1:8787/api/health | jq`,
`pnpm atlas:logs`.

## Architecture

Three workspaces (`pnpm-workspace.yaml`: `apps/*`, `packages/*`):

- `packages/domain` — types, the deterministic reasoning engine, and the
  synthetic Badge 17 fixture. Consumed as **TypeScript source** (`exports` maps
  `.` → `./src/index.ts`), so edits apply to both apps without a build step and
  both apps typecheck domain source.
- `apps/api` — Express routes, case store, provider hub, extraction, LangGraph
  orchestration.
- `apps/web` — React/Vite workspace rendering one `CaseState` through six lenses.

### The mutation pipeline

Every state change follows the same shape, and API routes never mutate case
state inline:

1. A route in `apps/api/src/app.ts` loads `CaseState` from the store.
2. It calls one **pure** domain function — `investigateAnomaly`,
   `applyCounterEvidence`, or `ingestLocalEvidence` in
   `packages/domain/src/reasoning.ts`. Each `structuredClone`s its input and
   returns `MutationResult { state, revision, auditSteps }`.
3. `revision === null` means the mutation was a no-op (they are idempotent); the
   route then skips persistence and the agent run entirely.
4. Otherwise the route persists, builds a bounded `CasePacket` via
   `store.buildCasePacket`, attaches an `AgentRun` through `AgentOrchestrator`,
   and pushes retrieval/checkpoint facts onto `auditSteps` — which is what the
   UI displays as the audit trail.

New reasoning belongs in `reasoning.ts` as a pure, unit-tested function, not in
a route handler.

`deduction.ts` is a second, purely _derived_ layer over the same state:
`buildDeductionChains`, `rankKeystoneAssumptions` and `findEvidentialSilences`
read `CaseState` and return analysis without persisting anything. Because they
are pure and take state as input, the web app calls them directly — they need no
API route, no collection and no schema migration. Keep it that way: anything
derivable belongs here rather than in the store.

### Storage (`apps/api/src/store.ts`)

`createStore` picks `MongoCaseStore` when `MONGODB_URI` is set, otherwise
`JsonCaseStore`. Both satisfy `CaseStore`. The JSON store is a credential-free
test/degraded fallback only — never describe it as the dev runtime while Atlas
is configured.

Mongo persistence is **snapshot-per-revision**, not incremental: `saveCase`
writes every `CaseState` array to its own collection (`collectionMap`) tagged
with `caseId` + `snapshotRevision`, then deletes documents from other revisions;
`getCase` reassembles the state from those collections and strips `_id`,
`snapshotRevision`, and embedding fields. Adding a top-level array to
`CaseState` therefore requires a `collectionMap` entry plus `normalizeCaseState`
defaulting, or existing saved cases break on load.

Observations are embedded on every save with on-device MiniLM
(`embeddings.ts`, 384 dims, cached under `.thread-cache/`). `buildCasePacket`
uses `$rankFusion` over `$vectorSearch` + `$search`, expands with
`$graphLookup`, and falls back to `boundedPacket` (lexical) whenever indexes
aren't queryable — the packet's `retrievalMethod` records which path ran, so
never relabel a fallback packet.

### Provider truthfulness (`apps/api/src/providers.ts`)

`ProviderHub.verify()` makes a real call per provider and stores an
`IntegrationStatus` with state `ready | degraded | blocked | unconfigured`.
Behavior gates on `providers.isActive(id)`, never on the presence of a key —
e.g. `extraction.ts` only attempts Fireworks visual extraction when active, and
otherwise records a warning and falls back to EXIF + local `tesseract` OCR.
`GET /api/health` composes store diagnostics + provider statuses and is
authoritative for anything the UI claims. Model outputs from OpenRouter land in
`beliefMemory` only; they are never promoted to evidence or world edges.

### Orchestration (`apps/api/src/orchestrator.ts`)

A LangGraph `StateGraph` with seven explicitly wired nodes (INGESTOR → RESOLVER
→ CHRONOLOGIST → LINKER → HYPOTHESIS ENGINE → FALSIFIER → INVESTIGATOR),
checkpointed to MongoDB with `thread_id = "<caseId>:<runId>"`. Nodes not in
`selectedAgents` still execute and record a `skipped` step — the visible
selected/skipped ledger is the point. The chain is written out node by node on
purpose: a loop would erase LangGraph's compile-time edge typing. Without
`MONGODB_URI` the orchestrator returns an uncheckpointed run with a null
`checkpointId` rather than pretending.

### Web (`apps/web/src`)

`App.tsx` owns all state: one `CaseState`, `HealthStatus`, the active `LensId`,
a `Selection`, and a `DrawerId` (`model.ts`). Mutations go through `runAction`,
which swaps in the server's returned state — components are projections and must
not hold their own case data. Every modal surface calls `useDialogDismiss`
(`useDialogDismiss.ts`) for Escape-to-close and focus restoration; its restore
is deferred and skipped while any `[role="dialog"]` is still mounted, because
StrictMode simulates an unmount that would otherwise steal focus straight back
out of a dialog that just opened. `scenarios.ts` declares the guided demo runs
as data — each maps to a real action App already performs, and
`scenarioAvailability` gates them on live health rather than assumption. `InvestigationBoard` maps lens → graph:
`evidence` → `EvidenceGraph`, `theory` → `BeliefGraph`, `time` →
`TimelineBoard`, everything else → `WorldGraph` filtered by `edge.lenses`; all
four are `lazy`-loaded. Clicking any node/edge sets a `Selection`, which
`Inspector.tsx` resolves into sources, contributions, assumptions, and
uncertainty. Vite proxies `/api` → `127.0.0.1:8787`; provider keys are
server-only and must never reach a `VITE_` variable.

## Conventions and gotchas

- ESM everywhere: relative imports use `.js` specifiers even for `.ts` sources.
- `tsconfig.base.json` sets `strict`, `noUncheckedIndexedAccess`, and
  `exactOptionalPropertyTypes` — hence patterns like the conditional spreads in
  `attachRun` (`...(x === undefined ? {} : { x })`) rather than passing
  `undefined`.
- ESLint runs `recommendedTypeChecked` with `--max-warnings 0`; Prettier uses
  `printWidth: 92`, single quotes, trailing commas.
- Web component tests need `// @vitest-environment jsdom` as the first line
  (there is no vitest config file in any workspace).
- Vite synthesizes named exports for CommonJS packages but Node does not, so a
  star import can pass every vitest suite and still throw under `tsx`. Import
  CJS dependencies (`exifr`) via their default export.
- Never assert on live provider state in a test. Assert the structure — that
  each integration carries one of the known state labels — or a repaired
  provider will fail the suite.
- Fixture IDs are stable and load-bearing: `EV-143`, `A-19`, `AN-J`, `R-C`,
  `case-badge-17` appear in domain logic, API routes, unit tests, and the
  Playwright spec. Changing one means changing all of them.
- `.thread-data/` (case JSON + preserved uploads) and `.thread-cache/` (model
  weights) are gitignored local state; `.env` is server-only and gitignored.
- Runtime targets Node 24+ / pnpm 11+ and every server binds to `127.0.0.1`.
