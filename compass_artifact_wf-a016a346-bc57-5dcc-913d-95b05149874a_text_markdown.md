# THREAD — Hackathon-Winning Build Plan Research Dossier
### MongoDB Persistent Context Sprint / .local Build Fest, Cerebral Valley @ Pier 48 SF

## TL;DR
- **Build THREAD as an ATMS-grounded "evidence-to-world-model engine" on MongoDB Atlas 8.1+, using `$rankFusion` hybrid search, Automated Embedding with Voyage AI, `$graphLookup` for case-packet assembly, and LangGraph (with `langgraph-checkpoint-mongodb`) for the agent swarm and time-travel.** This hits the core sponsor deepest and gives you the "WHAT CHANGED?" demo moment via checkpoint forking.
- **The ElevenLabs win is a live witness-interrogation agent**: Scribe v2 Realtime (~150ms, keyterms seeded from case entities) + the Agents Platform with server/client tools that extract claims live and ask the highest-information-gain follow-up — satisfying all four prize criteria (Agentic Depth, Interaction Design, Technical Integration, Novelty).
- **Intellectual depth is the differentiator**: ground the reasoning engine in real formal methods (Analysis of Competing Hypotheses, ATMS label propagation, Allen's interval algebra, the Admiralty Code 6×6 for the two-confidence model, and the FollowTheMoney ontology for the World Graph), and render uncertainty with a defensible visual encoding spec (VSUP + opacity/dash/blur) on a dark-mode forensic-dossier UI built with Cytoscape.js + ReactFlow + vis-timeline.

---

## Key Findings

### 1. MongoDB Atlas is the sharpest sponsor lever — go all-in
MongoDB Atlas in 2026 can serve THREAD's entire persistence + retrieval + memory layer natively. Confirmed capabilities:
- **Vector Search** via the `$vectorSearch` aggregation stage; HNSW ANN and ENN exact search; up to 8192 dimensions; scalar (int8, ~1/3.75 RAM) and binary (int1, ~1/24 RAM) quantization set in the index definition `quantization` field. ANN requires MongoDB ≥6.0.11, ENN ≥7.0.10.
- **Hybrid search** via `$rankFusion` (reciprocal rank fusion, `rank_constant` fixed at 60, per-pipeline `weights`, `scoreDetails: true`). Available on MongoDB 8.0+; **running `$vectorSearch` inside a `$rankFusion` sub-pipeline requires 8.1+.** Fallback for older versions: manual RRF via `$unionWith` + `$group`.
- **Automated Embedding** (Public Preview on Atlas since May 11, 2026) auto-generates embeddings from a text field using a Voyage AI model at index- and query-time; you can swap the model at query time via the `model` option in `$vectorSearch`. Community Edition GA first (MongoDB 8.2+); Atlas is in Public Preview.
- **Voyage models.** MongoDB acquired Voyage AI for **$220 million on Feb. 24, 2025**, per the MongoDB press release (PRNewswire): "MongoDB, Inc. (NASDAQ: MDB)…today announced it has acquired Voyage AI, a pioneer in state-of-the-art embedding and reranking models." Current models: `voyage-3.5`, `voyage-3.5-lite`, `voyage-3-large`, `voyage-context-3`, `voyage-multimodal-3.5` (video + interleaved text/image, released Jan 15, 2026), and rerankers `rerank-2.5` / `rerank-2.5-lite`. There is now also a **Voyage 4 model series**. Matryoshka dims 256/512/1024/2048; quantization float32/int8/uint8/binary. `voyage-multimodal-3.5` has a 32,000-token context window and embeds screenshots/PDFs/tables/figures/slides/video frames through a single transformer encoder (no modality gap) — **this is THREAD's CCTV/screenshot/photo embedder.**
- **Atlas Search** `$search` with `compound` (should/must/filter), `text` + `fuzzy: { maxEdits, prefixLength, maxExpansions }`, `autocomplete`, and the `embeddedDocument` operator for arrays of subdocuments — powers name/alias matching ("Bob"≈"Robert", "naw yark"≈"New York") for the RESOLVER agent. `maxEdits` is 1 or 2 (Levenshtein); `prefixLength` anchors leading chars; `maxExpansions` defaults to 50.
- **`$graphLookup`** for multi-hop traversal (`maxDepth`, `depthField`, `restrictSearchWithMatch`, `connectFromField`/`connectToField`; 100MB memory limit) — builds the "graph neighbors" portion of case packets.
- **Change Streams** (`watch()` on collection/db/cluster, resume tokens, `fullDocument`/`fullDocumentBeforeChange`, `$match` on `operationType` and `updateDescription.updatedFields`) — triggers selective agent re-runs on affected subgraphs.
- **LangGraph integration**: `langgraph-checkpoint-mongodb` (current release line 0.4.0; `MongoDBSaver.from_conn_string` with default db `checkpointing_db`, collections `checkpoints_aio`/`checkpoint_writes_aio`; note `AsyncMongoDBSaver` was deprecated/removed in the 1.0 line — use `MongoDBSaver` or the client-based constructor), plus `langchain-mongodb` (0.8.0) with `MongoDBAtlasVectorSearch`, `MongoDBAtlasHybridSearchRetriever`, `MongoDBGraphStore`, `MongoDBChatMessageHistory`, and the LangGraph Store for cross-thread long-term memory.
- **MongoDB MCP Server** (`npx -y mongodb-mcp-server@latest`): tools include `find`, `aggregate`, `aggregate-db`, `collection-schema`, `collection-indexes`, `count`, `create-index`, `explain`, plus Atlas management tools; flags `--readOnly`, `--indexCheck`, `--disabledTools`, `--transport http --httpPort`, env `MDB_MCP_CONNECTION_STRING`. Great live-demo moment: ask the assistant to query the case DB on stage.

**Free-tier caveat**: Some sources indicate M0/Flex tiers now support vector search with HNSW/ENN, 8192 dims, and quantization, but M0 has index and connection limits. Verify vector search availability on your exact M0 cluster during setup; use the hackathon's provided credits (M10+) to avoid M0 index-count limits biting mid-demo.

### 2. ElevenLabs — the "live interrogation" agent is the winning integration
- **Scribe v2 Realtime** (launched January 6, 2026) runs at ~150ms per ElevenLabs docs: "Realtime (Scribe v2 Realtime): Accepts a live audio stream over a WebSocket and returns partial and committed transcripts…at around 150ms latency. It supports up to 50 keyterms and word-level timestamps." Batch Scribe v2 supports up to **1000 keyterms of ≤50 chars**, 32-speaker diarization, and 65 entity types. Verbatim: "Batch supports up to 1000 keyterms (50 characters each), while realtime supports up to 50 keyterms (20 characters each)." THREAD seeds keyterms from case entities (unusual surnames, streets, product names) so persistent case memory literally improves future transcription accuracy — a clean narrative for "persistent context."
- **Agents Platform** (now "ElevenAgents"): four tool types (client, server/webhook, MCP, system). Webhook tools generate params dynamically and support an `LLM Prompt` param type; dynamic variables use `{{variable}}` syntax; secret vars use the `secret__` prefix (headers only, never sent to LLM); agent-to-agent handoff via the `transfer_to_agent` system tool (zero-indexed `agent_number`, per-rule conditions/delay/transfer-message). ElevenLabs agents can be an **MCP client** (connect to your MongoDB MCP server over SSE/HTTP-streamable, with Always-Ask / fine-grained / no-approval modes) — a genuinely deep integration. (Not available in Zero-Retention or HIPAA workspaces.)
- **React SDK** `@elevenlabs/react` with `useConversation`, `startSession({ agentId | signedUrl | conversationToken })`, `sendContextualUpdate(text)` (feed extracted claims back mid-interview without triggering a response), `onAudioAlignment` (character timing), and client tools that can block the conversation to await results. Signed-URL auth: `GET https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=…`.
- **TTS models** (exact IDs): `eleven_v3` (expressive, audio tags like `[whispers]`/`[sighs]`/`[laughs]`, ~5,000-char limit, **does NOT work on the `stream-input` WebSocket** — use Realtime Text-to-Dialogue for v3), `eleven_flash_v2_5` (~75ms, recommended for realtime, 0.5 credit/char, 40,000-char limit), `eleven_multilingual_v2` (29 langs). WebSocket streaming: `wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input`; multi-context: `…/multi-stream-input`.
- **Credits**: The Creator tier is **121,000 credits/month at $22/mo**, per ToolChase (prices re-verified against elevenlabs.io August 2026): "Creator $22: 121K credits (121 min), pro voice cloning, first month 50% off." Agents are **billed separately at "$0.08/min beyond your included block"** (~275 included call minutes on Creator); STT is billed per-hour in USD (Scribe v2 $0.22/hr, Realtime $0.39/hr, +$0.05/hr keyterms, +$0.07/hr entity detection). TTS is 1 credit/char (Multilingual) or 0.5 credit/char (Flash) → 121k credits ≈ ~120 min Multilingual or ~4 hrs Flash audio. One day of demo work is easily affordable; the binding constraint for an all-day live agent is per-minute Agent + separate LLM token cost, not the character credits. (The hackathon's stated "131k credits" may be promotional — confirm on the live pricing page.)

### 3. Fireworks AI — the vision/extraction workhorse
- **Vision-language models**: Qwen3-VL (8B/32B Instruct), Qwen2.5-VL (3B/7B/32B, 128k context), Llama vision, Fireworks-OCR, Phi-3.5 Vision. Pass images by URL or base64 data URI. Prompt caching cuts TTFT up to 80% (text + image portions cached).
- **Structured outputs**: JSON mode (`response_format={"type":"json_object","schema": Model.model_json_schema()}`) and Grammar mode (BNF); works with vision models; auto-enforces `unevaluatedProperties: false` to prevent hallucinated fields; supports `$ref`/`$defs` (RFC-6901 pointers). **This produces THREAD's typed Observation objects from images.**
- **Document Inlining**: append `#transform=inline` to a document/image URL in `image_url.url` to feed PDFs/multiple images into any (even non-vision) text model; combinable with JSON mode. Public preview, no added cost.
- **Reasoning**: `reasoning_effort` param supported on select models.

### 4. OpenRouter — the "Reasoning Router" for adversarial model diversity
Unified API; `models` array fallback + `route: "fallback"`; provider preferences (`order`, `only`, `ignore`, `allow_fallbacks`, `require_parameters`, `data_collection`, `sort`); shortcuts `:nitro` (= `provider.sort: "throughput"`) / `:floor` (= `provider.sort: "price"`) / `:online`; `require_parameters` and a soft-preference for `tools`/`response_format`/`verbosity`; `/api/v1/models` for capability discovery; **you only pay for successful completions** (failed/fallback requests aren't billed). Spec a router table mapping task → model family, and deliberately use a **different model family for the FALSIFIER** than the HYPOTHESIS ENGINE to get genuine adversarial diversity. Order the `models` array so the last entry is your most reliable floor model.

### 5. LangGraph — the swarm orchestration + time-travel engine
`StateGraph` with `add_node`/`add_edge`/`add_conditional_edges`; **Send API** for map-reduce fan-out to parallel agents (`Command(goto=[Send(...)])`); `interrupt()` for human-in-the-loop; **checkpoint time-travel** (rewind to any past checkpoint and fork; the original run is preserved) — this is the mechanism for "rewind the investigation to before Evidence 143 arrived." Parallel fan-out runs as a "superstep"; interrupted runs resume from the last completed superstep. Store API (BaseStore, put/get/search, namespaces, semantic search over embeddings) for long-term cross-thread memory. LangSmith tracing for demo-able observability; LangGraph Platform deploys via `langgraph.json` (hackathon provides $50 credits + deployments access).

### 6. Formal grounding — this is what beats a demo
- **Analysis of Competing Hypotheses (Heuer, *Psychology of Intelligence Analysis*)**: build a matrix of hypotheses × evidence, rate each cell Consistent/Inconsistent/Neutral, focus on **diagnosticity** (evidence that discriminates between hypotheses, not merely confirms one), select the hypothesis with the *least inconsistent* evidence, and actively seek disconfirmation. THREAD's Falsifier and "discriminative value" map directly onto ACH; note ACH also prescribes reporting the likelihood of *all* hypotheses and the alternatives considered.
- **ATMS (de Kleer 1986, AAAI)**: assumptions, justifications, environments (sets of assumptions), **nogoods** (minimal inconsistent environments), and label propagation. THREAD's belief cascade *is* an ATMS; use this vocabulary. A possibilistic/weighted (Π-)ATMS variant attaches certainty degrees to environments and handles confidence directly.
- **Allen's interval algebra**: the 13 relations (before/meets/overlaps/starts/during/finishes + their inverses + equals); a composition/transitivity table + path-consistency for constraint propagation and detecting temporal inconsistency (full consistency is NP-complete in general, but path-consistency is a cheap, practical approximation). The Chronologist uses this to reason over fuzzy time intervals.
- **Admiralty Code (NATO AJP-2.1, STANAG 2511)**: the 6×6 grid — source reliability A–F × information credibility 1–6, rated *independently* (a reliable source can carry doubtful info and vice-versa). This is the citable grounding for THREAD's two-confidence model (extraction confidence vs evidentiary strength). E.g. "B2 = usually-reliable source, probably-true info"; "F6 = untested source, unverifiable info."
- **FollowTheMoney ontology**: FollowTheMoney 4.0 was released **July 13, 2025**, per OpenSanctions: "This week, we are releasing version 4.0 of the FollowTheMoney (FtM) toolchain…the software framework and data model specification underpinning OpenSanctions, and the broader Aleph ecosystem." Entities have `id`/`schema`/`properties` (multi-valued strings); **interstitial entities** (Ownership, Directorship, Membership) model edges-with-attributes and intervals (`startDate`/`endDate`, `percentage`). Adopt the FtM schema (Person, Company, Address, Email, Phone, Passport, Payment, Documentation) for the World Graph for instant credibility. Python/Java/TypeScript libraries exist; installable via PyPI.

### 7. UI/Visualization — a rich, forensic, uncertainty-legible interface
- **Main case graph**: Cytoscape.js (richest analysis + layouts fcose/cola/elk/dagre/cise) for ≤~2000 nodes; Sigma.js v3 + graphology (WebGL) if you need larger; react-force-graph for a cinematic 3D option. 2026 rule of thumb: "Cytoscape for graph analysis, vis-network for interactive diagrams, Sigma for large WebGL graph rendering."
- **Belief/provenance DAG**: ReactFlow / XYFlow v12 (hand-authored dependency DAGs, custom nodes) — ideal for the ATMS justification network.
- **Timeline**: vis-timeline for event candidates as **intervals with uncertainty** (render fuzzy edges via gradient/opacity, e.g. 20:45–21:30 LOW-certainty as a soft-edged band).
- **Uncertainty encoding**: use VSUP — Michael Correll, Dominik Moritz & Jeffrey Heer, "Value-Suppressing Uncertainty Palettes," Proceedings of the 2018 CHI Conference (doi:10.1145/3173574.3174216): "VSUPs allocate larger ranges of a visual channel to data when uncertainty is low, and smaller ranges when uncertainty is high." Use the D3 module `uwdata/vsup`, plus opacity-as-confidence, dashed strokes for disputed edges, and blur/"confidence fog." Concrete spec: **83% edge** = solid, high opacity, saturated, thick; **47% edge** = thinner, semi-transparent, dashed; **disputed edge** = red/amber double-stroke with a small conflict glyph.
- **Aesthetic**: dark-mode forensic dossier — monospace (JetBrains Mono / IBM Plex Mono) for evidence IDs and metadata, serif (Newsreader / Source Serif) for the reconstruction narrative; index-card/manila/kraft accents, redaction bars, chain-of-custody stamps, Polaroid framing — cinematic without kitsch (steal Palantir Gotham's linked graph/map/timeline views, i2's timeline "theme lines," Maltego's transform pattern).
- **Motion**: Framer Motion (motion.dev) for SVG path-drawing "strings" being drawn/cut; the "WHAT CHANGED?" graph-diff uses animated edge removal/addition with morph transitions. Canvas beats SVG above ~1000 nodes; compute layout in a web worker (graphology) to keep the UI responsive; stream websocket/SSE updates into the live graph via a zustand store.

---

## Details

### 4.1 Data model (MongoDB collections)
Model THREAD's three graphs plus four memory types as collections:
- `evidence` (Graph A, immutable): artifact docs with `sha256`, `mimeType`, `ingestedAt`, raw-storage pointer. Each artifact CONTAINS `observations` and `claims`.
- `observations`: typed outputs (from Fireworks vision / STT), with `extractionConfidence` and `sourceEvidenceId`.
- `claims`: assertions extracted from artifacts, never treated as truth; carry `sourceReliability` (A–F) and `credibility` (1–6). (An email saying "Mike was at my house at 9" → `EMAIL_193 CONTAINS CLAIM_882`, *not* `Mike PRESENT_AT House 9:00`.)
- `entities` (Graph B, FtM schema): Person/Organization/Identity/Account/Location/Device/Vehicle/Event/TimeInterval as FtM `schema` values; `properties` multi-valued.
- `edges` (Graph B): AUTHORED/MENTIONS/USES/MAY_BE_SAME_AS/COMMUNICATED_WITH/OBSERVED_AT/TRAVELED_TO/etc., each with `confidence`, `sourceClaims[]`, `validTime`, `disputed`, `alternatives[]`, `createdByAgent`. Use FtM interstitial-entity pattern for attributed edges.
- `beliefs` (Graph C): Hypothesis/Assumption/Inference/Contradiction/UnresolvedQuestion/AlternativeExplanation nodes; `beliefEdges` with SUPPORTS/CONTRADICTS/DEPENDS_ON — the ATMS justification network.
- Memory: `memory_world`, `memory_evidence`, `memory_belief`, `memory_procedural` (the last logs InvestigationAttempts with question/strategy `{vectorK, keywordSearch, graphDepth, filters}`/returnedEvidence/usefulEvidence/utilityScore for retrieval-that-learns).
- **Bitemporal**: store both `validTime` (when it was true) and `transactionTime` (when we came to believe it) on edges/claims; optionally a time series collection for the observation stream.

Also model UnresolvedReference as a first-class object: `{ surfaceForm: "J", candidateBindings: [{entityId, prob}], resolvedBy }` — so ambiguity survives ingestion rather than being silently guessed away.

### 4.2 Vector index definition (Automated Embedding, Voyage)
```json
{
  "fields": [
    { "type": "text", "path": "content", "model": "voyage-3.5" },
    { "type": "filter", "path": "caseId" },
    { "type": "filter", "path": "entityType" }
  ]
}
```
For multimodal (CCTV frames/screenshots), embed with `voyage-multimodal-3.5` at 1024 dims, scalar quantization. Manual index for pre-generated vectors:
```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 1024,
      "similarity": "cosine", "quantization": "scalar" },
    { "type": "filter", "path": "caseId" }
  ]
}
```

### 4.3 Hybrid `$rankFusion` case-packet retrieval
```js
db.observations.aggregate([
  { $rankFusion: {
      input: { pipelines: {
        vectorPipeline: [ { $vectorSearch: { index: "obs_vec", path: "embedding",
          queryVector: qv, numCandidates: 200, limit: 50,
          filter: { caseId: CASE } } } ],
        lexicalPipeline: [ { $search: { index: "obs_text", compound: { should: [
          { text: { query: "Robert Chen", path: "text",
            fuzzy: { maxEdits: 1, prefixLength: 2 } } } ] } } }, { $limit: 50 } ]
      } },
      combination: { weights: { vectorPipeline: 1.0, lexicalPipeline: 0.7 } },
      scoreDetails: true
  } },
  { $limit: 20 }
])
```
Add a `$graphLookup` stage against `edges` (maxDepth 2) to append graph neighbors, and a `$unionWith` on `memory_procedural` to append the best previously-successful strategy. That assembled document **is** the "case packet" handed to an agent — never the whole case.

### 4.4 Agent swarm (LangGraph)
Model agents as **allowed mutations of the case model**, not personas: INGESTOR (artifact→observations), RESOLVER (references→candidate entities), CHRONOLOGIST (observations→event candidates), LINKER (events/entities→relationships), HYPOTHESIS ENGINE (case graph→competing explanations), FALSIFIER (hypothesis→strongest counterargument), INVESTIGATOR (gaps→next best question). Use `Send` to fan out per-artifact ingestion and per-hypothesis falsification in parallel. Checkpoint every superstep with `MongoDBSaver` (thread_id = caseId). **"WHAT CHANGED?"**: on new evidence, a Change Stream detects the affected subgraph, re-runs only the affected agents, and checkpoint forking renders the before/after belief diff — animated string-cutting in the UI.

### 4.5 OpenRouter Reasoning Router table (fits inside ~$10)
- INGESTOR / cheap extraction → a fast cheap model (`:floor`).
- Multimodal observation typing → Fireworks Qwen3-VL (direct, or via OpenRouter multimodal route).
- RESOLVER (alias resolution, mid reasoning) → a mid-tier reasoning model.
- HYPOTHESIS ENGINE (strong reasoning) → a frontier reasoning model.
- FALSIFIER → a **different** frontier family for adversarial diversity.
Use `require_parameters: true` with `response_format` so only structured-output-capable providers are chosen.

### 4.6 Formal reasoning engine (implementable in a day)
- **Two confidences**: store Admiralty (A–F, 1–6) per claim; combine into evidentiary strength via a documented verbal→numeric scale, keeping source reliability and info credibility as separate axes so one never contaminates the other.
- **ATMS-lite**: each Hypothesis node's label = set of assumption-sets (environments) that support it; when an assumption is invalidated (a new nogood), remove environments that are supersets of that nogood and cascade — exactly your "invalidate Camera 4's timestamp" demo. Store labels on `beliefs`; propagate with a simple worklist algorithm.
- **Allen algebra**: represent each event as a TimeInterval; run path-consistency over the 13 relations to detect contradictions (e.g., A before B, B before C, but C before A → flag a Contradiction node).
- **CASE COVERAGE metric**: ground in explanatory coherence (Thagard's ECHO) + ACH — report observed-directly %, multi-source-supported %, inferred %, unexplained %, contradiction count, and assumption count ("explains N/M material observations, contradicts X, leaves Y unexplained").
- **Value of Information (Investigator)**: rank unresolved questions by expected entropy reduction — for each candidate answer, compute the posterior hypothesis distribution, weight by the answer's probability, and pick the question that maximizes expected KL divergence / entropy drop between competing reconstructions.

### 4.7 Ingestion tooling
PyMuPDF/pdfplumber (PDF), python-docx (DOCX), Tesseract or Fireworks-OCR (images), ffmpeg (video frame extraction), exifread/PIL (EXIF GPS/timestamps), `.eml`/`.mbox` parsers (email), unstructured.io or IBM Docling for mixed ZIPs. Audio preserves linguistic hedging ("I think", "maybe") and represents time as an interval with certainty. Demo data: the **Enron email corpus** (public, license-clean) for realistic email; public-domain Conan Doyle for narrative flavor; plus a small hand-authored synthetic case with CCTV frames + badge logs + chat exports. Clone `mongodb-developer/GenAI-Showcase` as a scaffold for the agentic-memory + Atlas Vector Search patterns.

### 4.8 Judging strategy
Scoring weights: **Demo 30%, Creativity & Originality 35%, Impact 20%.** Lead the 1-minute video with the "WHAT CHANGED?" cascade — a single uploaded photo visibly cuts and redraws strings and flips a reconstruction. For the 3-minute live demo, run the ElevenLabs interrogation live (a judge speaks as the witness), show claims appearing in the graph in realtime, then invalidate an assumption and show the belief cascade. A live MongoDB MCP query on stage proves it's real data, not a mock.

### 4.9 Ethics/safety positioning (judges will ask)
Position THREAD explicitly as a **decision-support tool that refuses to output guilt verdicts**, keeps a human in the loop, and makes uncertainty legible. Cite the EU AI Act Annex III(6), which classifies as high-risk AI systems used by law enforcement "to evaluate the reliability of evidence in the course of the investigation or prosecution of criminal offences" (per artificialintelligenceact.eu), triggering Articles 9–15 requirements including human oversight (Art. 14); and the documented harms of facial-recognition wrongful arrests and algorithmic risk-assessment bias. Product guardrails: no "verdict" output (only reconstructions with every sentence labeled SUPPORTED / PARTIALLY SUPPORTED / INFERRED / DISPUTED / UNKNOWN), every claim inspectable to source with per-source weight contributions, confidence always visible, and an explicit "not admissible evidence" disclaimer.

---

## Recommendations

**Tonight (setup + spine):**
1. Provision Atlas with the hackathon's dedicated credits (not M0). Create `evidence`/`observations`/`entities`/`edges`/`beliefs`/memory collections and define the Automated-Embedding vector index (voyage-3.5) + an Atlas Search index (fuzzy). Wire the MongoDB MCP server into Cursor/Claude Code.
2. Stand up a LangGraph `StateGraph` with `MongoDBSaver` checkpointing; implement INGESTOR + RESOLVER + one retrieval path (`$rankFusion`). Get one artifact → observations → claims → entities flowing end to end.
3. Scaffold the UI: Cytoscape.js main graph + ReactFlow belief DAG + vis-timeline, dark forensic theme, zustand store fed by SSE.

**Tomorrow morning (depth):**
4. Implement ATMS-lite label propagation + Allen interval path-consistency; wire the "WHAT CHANGED?" cascade via Change Streams + checkpoint forking.
5. Build the ElevenLabs interrogation agent (Scribe v2 Realtime + keyterms from case entities + an Agents-Platform webhook tool that writes claims to Mongo + a VoI-ranked follow-up question).
6. Implement the CASE COVERAGE metric and the competing Alternative Reconstructions comparison view.

**Tomorrow afternoon (polish + demo):**
7. Uncertainty visual encoding (VSUP palette + opacity/dash/blur), the edge-explode-into-argument view, and the Anomaly Queue with an Investigate button.
8. Rehearse the 1-min video and 3-min live demo; pre-load the synthetic case; script the assumption-invalidation moment down to the second.

**Benchmarks that change the plan:** If Automated Embedding is flaky on your tier, fall back to manual Voyage embedding + manual `$vectorSearch`. If `$rankFusion` errors (version <8.1), use the manual `$unionWith` RRF pattern. If the live ElevenLabs agent is unstable on venue wifi, pre-record the interrogation segment as backup and use `eleven_flash_v2_5` (not v3) for the lowest-latency streaming path.

---

## Caveats
- **Automated Embedding is Public Preview on Atlas** (GA on Community Edition first, MongoDB 8.2+); verify it's enabled on your cluster tier before relying on it in the demo.
- **`$rankFusion` with `$vectorSearch` requires MongoDB 8.1+**; 8.0 supports `$rankFusion` but not vector sub-pipelines.
- **`AsyncMongoDBSaver` was deprecated/removed** in the `langgraph-checkpoint-mongodb` 1.0 line; use `MongoDBSaver` or the client-based constructor. Confirm the exact installed version — the API surface shifted between the 0.2.x/0.4.0 and 1.0 lines.
- **ElevenLabs Creator credits**: confirmed at 121,000/mo @ $22 (first month 50% off) by an August-2026 re-verified source; the hackathon's cited "131k" may be promotional. Agents (per-minute) and STT (per-hour USD) are billed **separately** from the character-credit pool, and LLM token cost for the agent is billed on top.
- **Voyage 4 series** now exists alongside voyage-3.5/multimodal-3.5; confirm which models are actually wired into Atlas Automated Embedding at build time (voyage-3.5 is safe; verify Voyage 4 availability before depending on it).
- Some sources say M0/Flex now support vector search, but M0 has index/connection limits that can bite mid-demo — use provided credits.
- **ElevenLabs RAG knowledge-base internals** (embedding model, chunk size) and **exact `eleven_v3` latency** were not verifiable in primary docs; treat as unspecified. A few third-party sources conflict on graph-library node ceilings and exact latency numbers — benchmark on your own data before promising figures on stage.