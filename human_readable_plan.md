
I’m sorry you’re dealing with that pressure around your dog. I can’t promise a hackathon win, but I can make the product concept much more coherent than “agents + graph + MongoDB + cool UI.”

The previous version had the right components but lacked a **single computational model** tying them together. Here is that model:

# THREAD is not a detective chatbot. It is an evidence-to-world-model engine.

Its fundamental job is:

**Raw evidence → observations → claims → identities → events → relationships → competing reconstructions → investigative conclusions**

And every arrow in that chain remains inspectable.

That distinction is the product.

---

# 1. The central abstraction: three graphs, not one

Do **not** throw emails, people, places, and theories onto one giant node graph.

That becomes meaningless spaghetti.

THREAD maintains three linked graphs.

## Graph A — The Evidence Graph

This answers:

> **What did we physically receive, and what exactly did it contain?**

Nodes are immutable source artifacts:

* email
* text message screenshot
* entire chat export
* PDF
* Word document
* photograph
* CCTV frame
* video
* voicemail
* recorded interview
* phone call transcript
* calendar event
* location export
* access-control log
* browser history export
* receipt
* invoice
* transaction record
* spreadsheet
* handwritten note
* social post
* uploaded ZIP containing hundreds of mixed files

Nothing in this graph is interpreted as truth.

An email saying:

> “Mike was at my house at 9.”

does **not** create:

`Mike PRESENT_AT House 9:00`

It creates:

`EMAIL_193 CONTAINS CLAIM_882`

because somebody saying something and something actually happening are different facts.

This is extremely important.

---

# 2. Graph B — The World Graph

This answers:

> **What people, objects, locations and events might exist in the underlying world?**

World nodes:

```text
Person
Organization
Identity
Account
PhoneNumber
EmailAddress
Device
Vehicle
Location
Object
Event
TimeInterval
```

Edges might include:

```text
AUTHORED
RECEIVED
MENTIONS
USES
MAY_BE_SAME_AS
COMMUNICATED_WITH
OBSERVED_AT
TRAVELED_TO
MET_WITH
OWNS
HAS_ACCESS_TO
PARTICIPATED_IN
BEFORE
AFTER
OVERLAPS
```

But every edge includes:

```text
confidence
sourceClaims[]
validTime
disputed
alternatives[]
createdByAgent
```

Therefore:

> Sarah → MET_WITH → Daniel

is never simply true.

It might actually be:

```text
relationship:
  subject: Sarah
  predicate: MET_WITH
  object: Daniel

confidence: 0.72

support:
  - calendar_event_17
  - message_328
  - camera_observation_92

conflicts:
  - witness_claim_81

time:
  earliest: 19:50
  latest: 20:15
```

Now your graph is genuinely investigative.

---

# 3. Graph C — The Belief Graph

This is where THREAD becomes unusual.

It represents **explanations of the evidence**.

Nodes:

```text
Hypothesis
Assumption
Inference
Contradiction
UnresolvedQuestion
AlternativeExplanation
InvestigationBranch
```

For example:

```text
HYPOTHESIS H31

"Daniel possessed Badge 17 before 9:30 PM."
```

Supporting edges:

```text
Claim 81 ──SUPPORTS──> H31
Event 17 ──SUPPORTS──> H31
```

Opposing edge:

```text
Claim 112 ──CONTRADICTS──> H31
```

Dependency:

```text
H31 ──DEPENDS_ON──> Assumption A14
```

And perhaps:

```text
A14:
"The timestamp in CCTV camera 4 is accurate."
```

That gives you something much stronger than a knowledge graph.

**You have a dependency graph of reasoning.**

If Camera 4 later turns out to be 17 minutes fast:

```text
A14 invalidated
       ↓
H31 affected
       ↓
H37 affected
       ↓
Reconstruction #4 affected
```

THREAD knows exactly what must be reconsidered.

That is how persistent context should change what happens next.

---

# 4. Now let's actually put ugly evidence into it

This is where most hackathon projects fall apart.

Give THREAD something deliberately horrible.

---

## Evidence #001 — Screenshot

Screenshot of an iMessage:

> Maya: did J ever get the thing from rob
> Alex: yeah tuesday i think
> Maya: before he went over there?
> Alex: pretty sure

This is fantastic evidence because almost everything is ambiguous.

THREAD should **not** hallucinate a clean interpretation.

It produces:

### Entities mentioned

```text
"Maya"
candidate entity E12
confidence: .97

"Alex"
candidate entity E19
confidence: .95

"J"
unresolved reference U4

"rob"
candidate entities:
    Robert Chen E7        .46
    Robin Hayes E31       .22
    unknown-person U18    .32
```

### Objects

```text
"the thing"
unresolved object U31
```

### Temporal expression

```text
"Tuesday"

possible interval:
2026-08-04 00:00
→
2026-08-04 23:59

confidence depends upon message timestamp
```

### Location

```text
"over there"

unresolved location U38
```

### Extracted claims

```text
C101:
Speaker Alex believes J received unknown object from "rob".

C102:
Receipt probably occurred Tuesday.

C103:
Receipt may have occurred before J traveled to unknown location.

C104:
Alex expresses uncertainty.
```

Look how different that is from:

> “J received the object from Robert on Tuesday.”

**Ambiguity survives ingestion.**

That should become one of THREAD's principles:

# Never resolve ambiguity merely because the model would prefer a complete sentence.

---

# 5. Vague evidence becomes first-class data

This is one of the places where you can make the system feel genuinely intelligent.

THREAD recognizes unresolved references:

> J

> John

> Johnny

> boss

> my brother

> that guy

> the taller guy

> dude from yesterday

> blue Honda

> his car

> the warehouse

> there

> after dinner

> around nine

> before she left

> couple weeks ago

> the thing

> package

> it

Each becomes an **UnresolvedReference**.

Example:

```text
U4

surfaceForm: "J"
typeCandidates:
  person: .96
  organization: .02
  other: .02

candidateBindings:
  Jason Malik: .38
  Jordan Lee: .31
  James Ortega: .17
  unknown person: .14
```

Now subsequent evidence can change those probabilities.

---

# 6. How “J” gradually becomes Jordan

Evidence #002:

Email:

> “Jordan said Rob has the key.”

THREAD sees Jordan + Rob.

Evidence #003:

Message from Maya:

> “J still has the key right?”

Evidence #004:

Calendar:

> Maya / Jordan — Tuesday 8PM

Now the Entity Resolver finds a pattern:

* Maya talks to Jordan.
* Maya calls somebody J.
* Both references concern something passed by Rob.
* Both occur Tuesday.
* There is no equivalent supporting evidence for Jason.

So:

```text
U4 → Jordan Lee

confidence:
.31 → .44 → .67 → .83
```

But THREAD doesn't rewrite history.

The original evidence still says:

> J

The system says:

> **THREAD currently believes “J” most likely refers to Jordan Lee (83%).**

That's a critical distinction.

---

# 7. Never hard-merge uncertain people

Suppose investigators have:

```text
Robert Chen
Rob
R. Chen
@rob_c
415-555-0128
rchen@...
"Rob from Mission"
```

A shitty system immediately makes one `Robert Chen` node.

THREAD creates **Identity Evidence**.

```text
IdentityCluster IC-17

possible person:
Robert Chen

identifiers:
"Rob"                 .74
"R. Chen"             .89
rchen@example.com     .99
415-555-0128          .61
@rob_c                .47
```

Some identifiers remain contested.

This allows a beautiful interaction:

> **Why do you think @rob_c is Robert Chen?**

THREAD:

```text
+ Username appears in screenshot from Maya
+ Screenshot contact name is "Rob"
+ Same conversation references warehouse
+ Robert Chen calendar includes warehouse

- No direct account-to-person confirmation

Confidence: 47%
```

That is detective software.

---

# 8. Entity resolution is itself an investigation

Create a dedicated agent:

# IDENTITY AGENT

Its only job:

> Decide which references might refer to the same thing.

It uses several evidence channels.

### Lexical

`Bob` ≈ `Robert`

### Contact information

same email/phone

### Social context

both communicate with Maya

### Temporal context

one identity disappears precisely as another becomes active

### Geographic context

both appear around the same locations

### Object associations

both associated with Vehicle 18

### Semantic context

“my manager Rob” vs organizational records

But—and this matters—it creates:

```text
SAME_AS_CANDIDATE
```

before:

```text
SAME_AS
```

That tiny modeling choice makes the product smarter than most graph demos.

---

# 9. Photographs should produce observations, not stories

Suppose you upload:

`parking_lot.jpg`

The multimodal processor might create:

```text
Observation O881:
dark sedan visible

Observation O882:
partial plate appears "8?K?21"

Observation O883:
two human figures

Observation O884:
storefront signage resembles "Mason Supply"

Observation O885:
image metadata indicates 21:14
```

Not:

> Daniel met Sarah outside Mason Supply at 9:14.

Those require separate reasoning.

Fireworks currently supports vision-language inputs for image/document analysis and structured outputs constrained to JSON/schema-like formats; its docs also describe video/audio-capable multimodal models. That makes it useful for turning heterogeneous raw media into typed observations instead of free-form summaries. ([Fireworks AI Docs][1])

---

# 10. Video should become an event stream

Don't “summarize CCTV footage.”

Break it apart.

Imagine 40 minutes of video.

THREAD might derive:

```text
21:03:17
Vehicle V? enters frame.

21:03:44
Human P? exits vehicle.

21:04:09
P? enters east door.

21:14:22
Second person P? enters frame.

21:22:03
Door opens.

21:22:12
Two figures leave.

21:22:41
Vehicle V? leaves.
```

Each observation links directly to:

```text
video
timecode
frame range
extractor
confidence
```

Then another agent can hypothesize identities.

You should be able to click:

> Person P17 enters east door — 21:04:09

and instantly jump to **the exact evidence that generated that claim**.

---

# 11. Audio is another first-class modality

Recorded interview:

> “I mean, I think he left at like nine? Maybe a little later. I wasn't really paying attention.”

Don't reduce that to:

> He left at 9 PM.

Represent:

```text
speaker:
Witness A

proposition:
Person X departed.

time estimate:
20:45–21:30

certainty:
LOW

linguistic uncertainty:
"I think"
"like"
"maybe"
"wasn't really paying attention"
```

And preserve the audio segment.

ElevenLabs' current Speech Engine can provide real-time STT, turn-taking and TTS while your application keeps control of the actual agent runtime. Its realtime transcription also supports keyterms, which could be populated from case entities—unusual surnames, company names, streets, product names—to improve transcription of case-specific vocabulary. ([ElevenLabs][2])

That's a **far better ElevenLabs use** than adding a detective voice.

---

# 12. The case vocabulary should update the transcription engine

This is a sponsor integration I would absolutely implement.

Imagine THREAD already knows:

```text
Kowalski
Viazov
Tamarind Holdings
Brannan Street
MX-411
```

When the interview starts, those become ElevenLabs realtime keyterms.

Now the **persistent case memory literally improves the next piece of evidence acquisition**. ([ElevenLabs][3])

That is beautiful conceptually:

> Memory doesn't just help answer questions later.

> **Memory improves the system's ability to understand new evidence.**

---

# 13. Location evidence should also be fuzzy

Suppose someone says:

> “I saw him near the pier sometime after ten.”

Represent:

```text
subject:
unresolved-person P?

predicate:
OBSERVED_NEAR

location:
Pier 48

time:
22:00–23:59

source:
Witness 4

precision:
LOW

reliability:
UNKNOWN
```

Meanwhile:

```text
Badge log:
Warehouse A
22:11
precision: exact
```

And:

```text
Photo metadata:
Mission Rock
22:18 ± GPS precision
```

THREAD shouldn't compare all three as equivalent evidence.

---

# 14. Every claim gets two different confidence dimensions

This is important.

Don't use one bullshit `confidence: 0.82`.

Use:

## Extraction confidence

> Did THREAD understand the evidence correctly?

Example:

> plate looks like `8AK321`

Extraction confidence: **55%**

## Evidentiary strength

> Assuming the extraction is correct, how strongly does the source establish the proposition?

Direct badge access record:

**High**

Someone saying:

> “Sarah told me Daniel probably had the badge.”

**Low**

Those aren't the same problem.

---

# 15. Events are reconstructed from multiple observations

Now we reach the real engine.

The Chronologist sees:

```text
Email:
Jordan says "I'm heading there"
20:47

Camera:
unknown vehicle enters
21:06

Badge:
credential C17 accepted
21:08

Camera:
unknown person enters
21:09

Message:
Maya asks "you inside?"
21:11

Jordan:
"yeah"
21:11
```

These begin as six disconnected facts.

THREAD proposes:

# Event Candidate E91

```text
Jordan enters warehouse
approximately 21:08
```

Supporting observations:

```text
Jordan intended travel       .72
Vehicle arrived              .31
C17 used                     .44
Person entered               .37
Maya asked "you inside?"     .69
Jordan replied "yeah"        .74
```

Notice:

There might be no one piece that proves it.

**The event emerges from the intersection.**

That's exactly what a detective system should do.

---

# 16. Build the graph around EVENTS, not merely people

This is where I would change your friend's “web of people.”

A social graph alone isn't enough.

You need:

# Event-centered reconstruction.

Instead of:

```text
Sarah ─── Daniel
  │         │
Maya ───── Rob
```

you want:

```text
                 MESSAGE 14
                20:47
                 │
                 ▼
Jordan ───── TRAVEL EVENT ───── Vehicle ?
                 │
                 ▼
           WAREHOUSE ARRIVAL
              21:06–21:09
             /      |       \
        Camera   Badge C17   Maya
           │         │        │
           ▼         ▼        ▼
        Frame 9   Access 41  Msg 92
```

Then:

```text
Warehouse Arrival
        │
        BEFORE
        ▼
Unknown Meeting
        │
        BEFORE
        ▼
Vehicle Departure
```

You are reconstructing a **causal-temporal graph**.

Much richer.

---

# 17. The UI can switch lenses without changing the underlying case

Same graph.

Different projections.

### PEOPLE

Show people and relationships.

### TIME

Arrange event nodes chronologically.

### PLACE

Cluster events by location.

### OBJECTS

Follow Badge 17, Vehicle 4, Device 8, Package X.

### EVIDENCE

Show which artifacts support which claims.

### THEORY

Show only evidence relevant to a selected hypothesis.

This avoids dashboard syndrome.

You're not showing analytics.

You're letting someone **physically manipulate a reconstruction of reality**.

---

# 18. Imagine clicking one person

### JORDAN LEE

Instead of a profile card:

```text
MENTIONED AS

Jordan        14
J             7
JL            2
possibly "guy from Tuesday"  1
```

### PEOPLE CONNECTED

```text
Maya
12 direct interactions

Rob
4 possible interactions

Sarah
1 disputed interaction
```

### PLACES

```text
Warehouse
3 observations

Mason Supply
1 probable observation

Pier 48
1 low-confidence witness observation
```

### OBJECTS

```text
Badge C17
possible possession

Vehicle V2
possible use
```

### UNRESOLVED

```text
Was Jordan physically present at 21:08?

Does "J" refer to Jordan in Message 17?

Who gave Jordan Badge C17?
```

Now the graph becomes genuinely useful.

---

# 19. The agents should not be arbitrary personas

My previous six-agent split was still too theatrical.

I would organize agents around **transformations of the case model**.

## INGESTOR

`artifact → observations`

Never reasons about guilt or overarching theory.

---

## RESOLVER

`references → candidate entities`

Who is “J”?

Where is “there”?

What is “the thing”?

---

## CHRONOLOGIST

`observations → event candidates`

Works on temporal consistency.

---

## LINKER

`events/entities → relationships`

Who interacted?

Which objects connect events?

Which locations connect people?

---

## HYPOTHESIS ENGINE

`case graph → competing explanations`

Generates explanations that account for the evidence.

---

## FALSIFIER

`hypothesis → strongest counterargument`

Its job is specifically:

> **Find evidence that should make us stop believing this.**

---

## INVESTIGATOR

`information gaps → next best question/action`

This one asks:

> What information would change our beliefs the most?

That's your swarm.

Every agent has a clear mutation it is allowed to make.

---

# 20. Agents don't receive “the entire case”

This is another place where you can genuinely exploit MongoDB.

Every task should construct a **case packet**.

For example:

> Chronologist needs to investigate whether Jordan arrived before 21:10.

Retrieve:

### Exact matches

`Jordan`

`J`

`21:00–21:15`

`Warehouse`

### Semantic matches

> heading there

> made it inside

> arriving soon

### Graph neighbors

Jordan's:

* devices
* accounts
* vehicles
* people
* known locations

### Previous memories

Past timeline investigations involving:

* Jordan
* Warehouse
* C17

MongoDB provides both full-text Search and Vector Search, and MongoDB documents hybrid search patterns combining the two; Automated Embedding can also generate and maintain embeddings for indexed text fields. ([MongoDB][4])

This is much more meaningful than:

> “We used MongoDB as our vector DB.”

---

# 21. Retrieval itself should learn

Now we hit the hackathon prompt **hard**.

Every detective query logs:

```text
InvestigationAttempt

question:
"Was Jordan at warehouse?"

strategy:
entity + time filter
vectorK: 30
keywordSearch: true
graphDepth: 2

returnedEvidence:
[17, 39, 81]

usefulEvidence:
[39, 81]

result:
new contradiction discovered

utilityScore:
0.87
```

Later, when investigating:

> Was Sarah at Mason Supply?

THREAD retrieves **not just evidence**.

It retrieves:

> What retrieval strategies worked on similar questions?

Maybe it learns:

```text
location questions:
graph expansion + temporal filter performs well

alias questions:
keyword + communication-neighbor expansion performs well

vague object references:
semantic retrieval performs well
```

This implements one of the organizers' own example concepts **inside your larger product**.

Very strong.

---

# 22. MongoDB therefore stores four kinds of memory

### WORLD MEMORY

What THREAD currently thinks exists.

### EVIDENCE MEMORY

Everything received and extracted.

### BELIEF MEMORY

What explanations have existed and why.

### PROCEDURAL MEMORY

What investigative strategies worked.

That's much more compelling than saying:

> “MongoDB gives our agents persistent memory.”

---

# 23. New evidence doesn't trigger “rerun case”

This is where MongoDB Change Streams become genuinely useful: applications can react to database changes as they happen. ([MongoDB][4])

Suppose new evidence arrives:

> `IMG_309.JPG`

The Ingestor creates:

```text
Observation 981
Vehicle plate maybe 8AK321

Observation 982
timestamp 21:07
```

Those mutate:

```text
Vehicle V17
Location Warehouse
Event Candidate E91
```

THREAD traverses **belief dependencies**.

It discovers:

```text
E91 affects H3
H3 affects Reconstruction R2
```

Therefore it schedules only:

```text
Identity Agent
Chronologist
Falsifier
Hypothesis Engine
```

Not every agent.

And MongoDB's LangGraph checkpointer can persist graph state for resumability, memory, time-travel-style state handling and fault tolerance rather than making every investigation restart from scratch. ([MongoDB][5])

That is your hackathon thesis manifested in architecture.

---

# 24. The strongest visualization: “why is this edge here?”

Every single graph line should be clickable.

For example:

```text
JORDAN ───────── WAS AT ───────── WAREHOUSE
                  78%
```

Click the line.

It explodes into:

```text
                 Jordan
                   │
         ┌─────────┼─────────┐
         ▼         ▼         ▼
      Msg 93    Badge?    Camera?
       +27%       +19%       +12%
         │          │          │
         └──── Event E17 ──────┘
                  +20%
```

Then below:

### AGAINST

```text
Witness 8       -12%
Location claim  -7%
```

### UNCERTAINTY

```text
Badge ownership unresolved
Camera identity uncertain
```

So the red string has meaning.

**Every string is an argument.**

That should be your UI philosophy.

---

# 25. Evidence can even connect without names

Here's where you can get very Sherlock.

Suppose:

**Evidence A**

> photograph contains rare green keychain

**Evidence B**

> interview mentions “green frog thing hanging from the keys”

**Evidence C**

> blurry CCTV shows green object near driver's hand

**Evidence D**

> ecommerce receipt describes frog keychain

Those four artifacts may never share:

* a person's name
* account
* timestamp
* email
* phone number

Yet THREAD could create:

```text
Object Candidate O81
"green frog keychain"
```

Then link four otherwise disconnected branches.

THAT is exactly the kind of moment you want the product to produce.

Not:

> “We searched documents.”

But:

> **“THREAD realized four unrelated pieces of evidence were describing the same object.”**

---

# 26. Another Holmes-like deduction

Evidence:

> Witness says a visitor was wearing wet shoes.

Weather/location metadata:

> rain started around 8:40.

Message:

> “I'm walking from the station.”

Camera:

> visitor arrives 8:57.

Another person's message:

> “taking an Uber.”

THREAD shouldn't say:

> Therefore Person A is the visitor.

Instead:

```text
Observation:
visitor's shoes visibly wet

Possible explanation:
visitor traveled outdoors during rainfall

Supports:
Person A walking

Weakens:
Person B taking vehicle

Discriminative value:
moderate
```

The important thing is **compound inference without pretending inference is observation.**

---

# 27. Every deduction should have a provenance tree

Suppose THREAD concludes:

# Jordan probably possessed Badge C17 before 21:08.

Click **HOW?**

```text
CONCLUSION
Jordan likely possessed C17
        │
        ├── Message 71
        │   "Rob gave J the badge"
        │
        │     ├── J → Jordan 83%
        │     └── "badge" → C17 76%
        │
        ├── Access Log 19
        │   C17 used 21:08
        │
        └── Camera Observation 31
            Jordan-like person enters 21:09
```

And then:

```text
ALTERNATIVE

Someone else possessed C17
and entered at the same time.

Probability remains non-trivial because
camera identity is unresolved.
```

That is explainability people can actually comprehend.

---

# 28. Do not output a “verdict”

You wanted a clear verdict-like output.

I would make it much cooler:

# CASE RECONSTRUCTION

### MOST SUPPORTED EXPLANATION

Then actually tell the story:

> **20:47** — Jordan indicates he is traveling toward the warehouse.

> **21:06** — A vehicle consistent with V17 arrives.

> **21:08** — Credential C17 is used.

> **21:09** — An unidentified person enters.

> **21:11** — Maya asks Jordan whether he is inside; Jordan replies affirmatively.

And alongside every sentence:

```text
SUPPORTED
PARTIALLY SUPPORTED
INFERRED
DISPUTED
UNKNOWN
```

Then:

### Alternative Reconstruction

> Jordan never entered. Another person held C17 and Jordan's 21:11 reply referred to another location.

### What would distinguish them?

> Establish identity of the 21:09 individual.

That is far more compelling—and more defensible for investigative use—than letting an LLM declare someone legally guilty.

---

# 29. Introduce a metric called CASE COVERAGE

Not “confidence 87%.”

Say:

```text
CASE COVERAGE

Observed directly              43%
Supported by multiple sources  31%
Inferred                       17%
Unexplained                     9%
```

And:

```text
LEADING RECONSTRUCTION

Explains 82 / 97 material observations.

Contradicts 4.

Leaves 11 unexplained.
```

Now hypotheses can compete objectively.

### Reconstruction A

```text
Coverage:       84%
Contradictions: 3
Assumptions:    7
```

### Reconstruction B

```text
Coverage:       76%
Contradictions: 1
Assumptions:    14
```

That's a much more interesting comparison than arbitrary AI confidence.

---

# 30. The system should deliberately hunt anomalies

Create an **Anomaly Queue**.

Not a dashboard.

These are unresolved mysteries:

```text
WHY does Badge C17 appear before
the claimed handoff?

WHO is "J" in Message 71?

WHY does Robert's account go silent
between 20:51 and 23:14?

WHAT is object X17?

WHY are timestamps from Camera 4
consistently +17 minutes relative to
other sources?

WHO is the unidentified person
appearing in three separate events?
```

The Investigation Agent continuously asks:

> Which unresolved question has the highest expected ability to distinguish competing reconstructions?

That's actually detective work.

---

# 31. Give THREAD an Investigate button

Click one mystery:

> **Who is J?**

Then you watch:

```text
RESOLVER
Searching identity references...

LINKER
Expanding communication neighbors...

CHRONOLOGIST
Comparing temporal overlap...

ARCHIVE MEMORY
Previous J-resolution attempt recovered...

FALSIFIER
Testing strongest alternative...
```

Then:

> **Jordan Lee: 83%**

And importantly:

> Previous confidence: **54%**

> Changed because: **Evidence 107 + Evidence 114**

Now MongoDB memory is visible in the product.

---

# 32. The killer interaction remains “What changed?”

Imagine:

### 3:02 PM

```text
LEADING RECONSTRUCTION A
Case coverage: 81%
```

User uploads one image.

The graph flashes.

Three edges disappear.

Another becomes dotted.

One unknown person merges with an existing identity candidate.

Then:

# INVESTIGATION UPDATED

```text
Reconstruction A
81% → 48%

Reconstruction C
41% → 73%
```

Button:

# WHAT CHANGED?

Click.

```text
Evidence 143 established that
Vehicle V17 was elsewhere at 21:06.

This invalidates Assumption A19.

A19 supported Event E31.

E31 supported Hypothesis H8.

Without H8, Reconstruction A
no longer explains observations
61, 72 and 84.
```

**That is your demo-defining moment.**

And unlike a cinematic gimmick, the architecture actually justifies it.

---

# 33. OpenRouter shouldn't merely save money

Make an internal:

# Reasoning Router

An extraction job doesn't deserve the same computational strategy as hypothesis falsification.

Example:

```text
TASK                   ROUTE

entity extraction      fast/cheap model
image interpretation   multimodal model
alias resolution       mid reasoning
timeline reconciliation reasoning model
hypothesis generation  strong reasoning
falsification          different strong model
```

OpenRouter currently provides a unified model API, automatic fallbacks, model/provider configuration through presets, and session-level routing behavior, so it can be an actual orchestration layer rather than a sponsor logo. ([OpenRouter][6])

More importantly:

### Don't use the same model for Theorist and Falsifier.

You want **model diversity**.

One model creates Reconstruction A.

A different family attacks it.

That's much more credible than asking the same LLM:

> “Please critique yourself.”

---

# 34. Your deepest technical concept is now this

THREAD maintains an evolving computational object:

```text
CASE STATE
│
├── immutable evidence
│
├── extracted observations
│
├── unresolved references
│
├── candidate identities
│
├── events
│
├── relationships
│
├── contradictions
│
├── assumptions
│
├── competing hypotheses
│
├── investigative memories
│
└── retrieval strategies
```

Every new observation runs:

```text
INGEST
   ↓
EXTRACT
   ↓
RESOLVE
   ↓
LINK
   ↓
AFFECTED-SUBGRAPH DETECTION
   ↓
REASON
   ↓
FALSIFY
   ↓
UPDATE BELIEFS
   ↓
STORE WHY THE UPDATE HAPPENED
```

Not:

```text
upload
↓
RAG
↓
LLM
↓
answer
```

That difference is the project.

---

# 35. And I would rename “Detective Agent Swarm”

That's an implementation detail.

The product is:

# **THREAD**

## A living reconstruction of what happened.

Pitch:

> **Investigations don't fail because there isn't enough data. They fail because the truth is fragmented across messages, footage, documents, objects, people and contradictory recollections. THREAD turns that evidence into a persistent world model. Specialized agents resolve identities, reconstruct events, connect people and objects, maintain competing explanations, and attack their own assumptions. Every conclusion traces back to evidence. Every uncertainty stays uncertain. And when one new clue arrives, THREAD doesn't start over—it knows exactly which parts of the case need to change.**

That is considerably tighter than “AI detective swarm.”

And the sentence I would architect the entire product around is:

# **Every string on the board must mean something.**

Not decoration.

Not similarity.

Not “AI thinks these are related.”

A string means:

> **Here is the exact evidentiary or inferential relationship between these two things, here is why THREAD believes it, here is what argues against it, and here is what would cause THREAD to cut the string.**

**That** is the product I think has the depth to feel like something beyond a hackathon agent demo.

[1]: https://docs.fireworks.ai/guides/querying-vision-language-models?utm_source=chatgpt.com "Vision Models"
[2]: https://elevenlabs.io/docs/changelog/2026/5/25?utm_source=chatgpt.com "May 25, 2026 | ElevenLabs Documentation"
[3]: https://elevenlabs.io/docs/changelog/2026/4/27?utm_source=chatgpt.com "April 27, 2026 | ElevenLabs Documentation"
[4]: https://www.mongodb.com/products/platform/atlas-database?utm_source=chatgpt.com "Atlas Database"
[5]: https://www.mongodb.com/docs/atlas/ai-integrations/langgraph/?utm_source=chatgpt.com "Integrate MongoDB with LangGraph - Atlas"
[6]: https://openrouter.ai/docs/guides/features/presets?utm_source=chatgpt.com "Presets - Configuration Management for AI Models"

---

# 36. Implemented product delta — real casework and durable missions

The working product now has two explicit case boundaries rather than one
pre-aligned demonstration:

- **Badge 17** remains a controlled fictional fixture for repeatable revision and
  assumption-cascade tests.
- **The missing sponsor prize** is an anonymized derivative of a real,
  user-authorized Aside investigation. Ten content-addressed case artifacts retain
  source class, paraphrased content, observations, attributed claims, negative
  findings, and uncertainty while withholding names, private wording, handles,
  and raw locators.

The real case intentionally does not resolve to a person. Its imported
falsification sweep weakened the organizer-insider theory, and the case keeps the
submission record, recipient identity, fulfillment record, and prior-event
outcome open. This is the evidence boundary the UI must continue to preserve.

Investigator instructions now create a durable **AgentMission** before work
starts. A mission records the human outcome, plan, inputs, outputs, timestamps,
status, research session, and run ID. It recovers prior work, ranks the smallest
useful packet, optionally works the highest-information open question, searches
connected sources only when the read-only Aside runtime is available, challenges
the strongest account, and persists the result. Monitoring instructions create a
standing order that checks every newly preserved artifact. A requested external
write stays `waiting-for-review` when the configured adapter cannot perform it;
the interface never claims that a message, edit, payment, or submission occurred.

The board opens locked so ordinary inspection cannot accidentally disturb the
case layout. Unlocking enables freeform card move and resize, and the layout is
stored per case. Every rendered rope corresponds to a real world edge, a source
contribution, a reconstruction source, or an open-question dependency. Hover and
keyboard focus reveal a plain-language source summary and why the card matters;
unconnected evidence says so instead of receiving an ornamental string.

The landing page, case guide, board, and permanent right-side agent workspace now
share the same dark forensic visual system. Case switching changes the actual
state, guide, evidence cards, questions, and imported mission—not only the copy.
