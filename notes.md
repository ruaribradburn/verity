# Verity Agent — Product Requirements Document

**Version:** 0.2
**Date:** April 2026

---

## 1. Vision

Verity Agent is a voice-first multimodal AI copilot that accompanies users as they browse the internet, helping them detect bias, identify misinformation, surface omitted context, and build a richer understanding of the information they consume. It operates in real time via a persistent voice interface powered by Gemini Live API.

The long-term goal is an always-on intelligence layer: a personal media-literacy analyst that learns what topics the user cares about, builds a living knowledge graph from their browsing, and proactively enriches stories with missing perspectives.

---

## 2. Core Capabilities

### 2.1 Real-Time Page Analysis

- Parses the content of any web page the user is viewing, leveraging Gemini Live's built-in web comprehension and search grounding.
- Extracts key claims, sourcing, and framing choices.
- Flags common bias patterns: selection bias, framing effects, appeal to emotion, omission of counter-evidence.
- Distinguishes between hard news reporting, opinion/editorial, sponsored content, and satire.

### 2.2 Entity Extraction & Knowledge Graph

A continuous entity-extraction loop runs against every page and conversation turn:

- **Entities extracted:** People, organisations, locations, events, policies, statistics, claims.
- **Relationships mapped:** Funding flows, ownership structures, affiliations, quote attribution.
- **Graph built in real time:** Each browsing session enriches a persistent, user-owned knowledge graph.
- **Cross-referencing:** New entities are checked against previously encountered ones to surface connections the user may not have noticed.

### 2.3 Parallel Sub-Agent Research (Fan-Out)

When a claim or entity warrants deeper investigation, Verity spawns lightweight research sub-agents that run in parallel:

| Sub-Agent Type | Purpose |
|---|---|
| **Source Profiler** | Who funds this outlet? What is its editorial track record? Ownership structure? Known biases? |
| **Claim Verifier** | Cross-references a specific claim against fact-check databases, academic sources, and primary documents. |
| **Historical Context** | Retrieves the backstory on a subject — what happened before, what the trajectory has been. |
| **Perspective Scout** | Finds coverage of the same story from outlets in different countries, languages, and cultural contexts. |

Results from sub-agents are synthesised and surfaced to the user as a brief spoken summary with an option to drill deeper.

### 2.4 Multi-Cultural Perspective Sourcing

- Actively checks local-language news sources to gather perspectives from different cultures and regions.
- Translates and summarises foreign-language coverage so the user can understand how a story plays elsewhere.
- Highlights where international coverage diverges meaningfully from domestic framing.

### 2.5 Intelligence Dashboard (Phase 4)

A visual dashboard that compiles and presents:

- Topics the user has researched over time.
- The knowledge graph, explorable and searchable.
- Source reliability scores based on accumulated evidence.
- Trend lines showing how narratives around a topic have shifted.
- Alerts when new information materially changes a previously reviewed story.

---

## 3. Moral & Epistemic Framework

Verity operates under a clearly defined epistemic code — not a political one.

### 3.1 The Golden Rule as Sole Moral Anchor

Verity holds one moral principle: **treat others as you would want to be treated.** It does not moralise, lecture, or adopt ideological positions beyond this. It applies this principle when evaluating whether coverage dehumanises, scapegoats, or strips agency from any group.

### 3.2 Balanced Without False Equivalence

- Presents multiple legitimate perspectives on genuinely contested questions.
- Does **not** manufacture balance where the evidence is overwhelmingly one-sided (e.g., treating fringe pseudoscience as equivalent to scientific consensus).
- Clearly distinguishes between "this is debated among experts" and "this is debated on social media."

### 3.3 Uncertainty-First Language

- Uses calibrated uncertainty language: *"the available evidence suggests,"* *"this is widely accepted but not uncontested,"* *"sources disagree on this point."*
- Avoids declarative moral pronouncements.
- Defers final judgement to the user — Verity's role is to inform, not to decide.

### 3.4 Anti-Prescriptive Stance

- Never tells the user what to think or how to feel.
- Never pre-empts the user's own reasoning with unsolicited conclusions.
- When asked directly for an opinion, responds with the strongest arguments on each side and an honest assessment of where the weight of evidence falls — then steps back.

---

## 4. Interaction Model

### 4.1 Voice-First

- Primary interface is a continuous voice conversation via Gemini Live.
- The user can ask questions, request analysis, or simply browse while Verity listens and offers proactive nudges (configurable intrusiveness level).

### 4.2 Proactive vs. Reactive Modes

| Mode | Behaviour |
|---|---|
| **Sentinel** (default) | Monitors silently; speaks up only when it detects a significant bias signal, misleading claim, or missing context. |
| **Analyst** | Provides a running commentary on the page being viewed — suitable for deep-research sessions. |
| **On-Demand** | Stays silent unless directly addressed. |

### 4.3 Conversational Patterns

- "What am I missing here?"
- "Who funds this publication?"
- "How is this story being covered in [country/region]?"
- "Is this claim supported?"
- "Show me the other side of this."

---

## 5. Technical Architecture

### 5.1 Stack Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  BROWSER                                                        │
│                                                                 │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐ │
│  │  Chrome Extension     │  │  Dashboard SPA (TypeScript)      │ │
│  │  (content script +    │  │  React · D3/force-graph          │ │
│  │   page capture)       │  │  WebSocket client                │ │
│  └──────────┬────────────┘  └──────────────┬───────────────────┘ │
│             │  page content / DOM            │  graph updates     │
│             ▼                               ▼                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │              Verity WASM Module (Rust → wasm32)              │ │
│  │  ┌────────────────────────────────────────────────────────┐  │ │
│  │  │  Local Processing Layer                                │  │ │
│  │  │  • DOM text extraction & sanitisation                  │  │ │
│  │  │  • Client-side entity pre-extraction (NER heuristics)  │  │ │
│  │  │  • Graph diff computation                              │  │ │
│  │  │  • Audio capture → PCM 16kHz encoding                  │  │ │
│  │  └────────────────────────────────────────────────────────┘  │ │
│  └──────────────────────────┬───────────────────────────────────┘ │
└─────────────────────────────┼───────────────────────────────────┘
                              │ WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  VERITY CORE SERVICE  (Rust · Rig · Tokio)                      │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Session Manager                                          │  │
│  │  • Authenticated WebSocket per user                       │  │
│  │  • Manages Gemini Live session lifecycle (10 min window)  │  │
│  │  • Ephemeral token rotation for Gemini API auth           │  │
│  └────────────────────┬───────────────────────────────────────┘  │
│                       │                                         │
│  ┌────────────────────▼───────────────────────────────────────┐  │
│  │  Gemini Live Bridge  (Inner Loop)                         │  │
│  │                                                           │  │
│  │  Persistent WebSocket → Gemini Live API                   │  │
│  │  Model: gemini-live-2.5-flash-native-audio                │  │
│  │                                                           │  │
│  │  Responsibilities:                                        │  │
│  │  • Bi-directional voice streaming (PCM 16kHz in/24kHz out)│  │
│  │  • Page content injection as text context                 │  │
│  │  • Voice Activity Detection (built-in)                    │  │
│  │  • Barge-in handling                                      │  │
│  │  • Tool use: function calling → sub-agent dispatch        │  │
│  │  • Search grounding for real-time fact queries            │  │
│  │  • Audio transcription (both directions)                  │  │
│  └────────────────────┬───────────────────────────────────────┘  │
│                       │ function calls / structured output      │
│                       ▼                                         │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Agent Orchestrator  (Outer Loop — Rig)                   │  │
│  │                                                           │  │
│  │  Rig agent pipelines managing:                            │  │
│  │  • Entity extraction (prompt chain → structured output)   │  │
│  │  • Bias detection pipeline (classify → score → explain)   │  │
│  │  • Sub-agent fan-out via Rig parallelisation pattern      │  │
│  │  • Result synthesis & ranking                             │  │
│  │  • Epistemic guardrail evaluation                         │  │
│  │                                                           │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  Sub-Agent Pool  (Rig orchestrator-worker pattern)  │  │  │
│  │  │                                                     │  │  │
│  │  │  ┌──────────┐ ┌──────────┐ ┌───────────────────┐   │  │  │
│  │  │  │ Source   │ │ Claim    │ │ Perspective       │   │  │  │
│  │  │  │ Profiler │ │ Verifier │ │ Scout             │   │  │  │
│  │  │  │          │ │          │ │ (multi-language)   │   │  │  │
│  │  │  └──────────┘ └──────────┘ └───────────────────┘   │  │  │
│  │  │  ┌──────────┐ ┌──────────────────────────────────┐ │  │  │
│  │  │  │Historical│ │ Entity Enricher                  │ │  │  │
│  │  │  │ Context  │ │ (cross-ref against known graph)  │ │  │  │
│  │  │  └──────────┘ └──────────────────────────────────┘ │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └────────────────────┬───────────────────────────────────────┘  │
│                       │                                         │
│  ┌────────────────────▼───────────────────────────────────────┐  │
│  │  Knowledge Graph Engine                                   │  │
│  │                                                           │  │
│  │  Storage: SurrealDB (graph + document + vector in one)    │  │
│  │  • Entity nodes with embedding vectors (Rig embedding)    │  │
│  │  • Relationship edges with provenance metadata            │  │
│  │  • Temporal versioning (when was this edge first seen?)   │  │
│  │  • Semantic search via cosine similarity on embeddings    │  │
│  │  • Per-user namespace isolation                           │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 The Two Loops

The architecture is built around two interlocking loops with distinct responsibilities:

**Inner Loop — Gemini Live (real-time, latency-critical)**

This is the voice-first conversational core. Gemini Live maintains a stateful WebSocket session with the user, handling bi-directional audio streaming, voice activity detection, barge-in, and affective dialogue. When it needs external information or wants to trigger analysis, it issues function calls that the outer loop fulfils.

The inner loop is responsible for:
- Natural conversation flow and turn-taking.
- Interpreting user intent from voice input.
- Presenting synthesised results as natural speech.
- Deciding *when* to proactively alert the user (Sentinel mode logic).
- Using Google Search grounding for quick factual lookups.

The Gemini Live session has a 10-minute default window. The Session Manager handles transparent reconnection with context carryover, serialising the conversation state and re-injecting it on the new session.

**Outer Loop — Rig Agent Orchestrator (throughput-critical, parallelisable)**

This is where the heavy analytical work happens. Rig provides the orchestration patterns — prompt chaining, parallelisation, orchestrator-worker, and evaluator-optimizer — as composable Rust pipelines. When Gemini Live issues a function call (e.g., `verify_claim`, `profile_source`, `find_perspectives`), the outer loop:

1. Receives the structured function call.
2. Routes it to the appropriate Rig agent pipeline.
3. Fans out sub-agents in parallel using `tokio::spawn`.
4. Aggregates and ranks results.
5. Runs the epistemic guardrail evaluator (uncertainty calibration, false-equivalence check).
6. Returns the synthesised result to Gemini Live as a function call response.

### 5.3 Component Specifications

#### Browser Layer (TypeScript)

| Component | Technology | Role |
|---|---|---|
| Chrome Extension | Manifest V3, TypeScript | Captures visible page content (DOM text, metadata, URL). Sends to WASM module or directly to backend via WebSocket. |
| WASM Module | Rust → `wasm32-unknown-unknown` via `wasm-pack` | Client-side pre-processing: text extraction, entity pre-tagging, audio PCM encoding. Keeps latency-sensitive work off the network. |
| Dashboard SPA | React 19, TypeScript, D3 force-graph | Visualises the knowledge graph, source reliability scores, topic timelines. Receives real-time updates over the same WebSocket. |
| Audio I/O | Web Audio API / MediaStream | Captures microphone input at 16kHz 16-bit PCM mono. Plays Gemini responses at 24kHz. |

The WASM module is compiled from a Rust crate (`verity-client`) using `wasm-pack`. It exposes a small API surface to TypeScript via `wasm-bindgen`:

```rust
// verity-client/src/lib.rs (conceptual)

#[wasm_bindgen]
pub fn extract_page_text(html: &str) -> JsValue {
    // Strips boilerplate, extracts article body, metadata
    // Returns structured PageContent as JSON
}

#[wasm_bindgen]
pub fn pre_extract_entities(text: &str) -> JsValue {
    // Fast heuristic NER (regex + gazetteer-based)
    // Returns candidate entities for server-side confirmation
}

#[wasm_bindgen]
pub fn compute_graph_diff(
    local_entities: &str,
    server_entities: &str
) -> JsValue {
    // Computes delta for incremental graph updates
}

#[wasm_bindgen]
pub fn encode_audio_pcm(samples: &[f32]) -> Vec<u8> {
    // Converts Web Audio float32 samples to 16-bit PCM
}
```

#### Verity Core Service (Rust)

| Component | Crate / Technology | Role |
|---|---|---|
| HTTP/WS Server | `axum` + `tokio` | Handles client WebSocket connections, REST endpoints for dashboard data. |
| Session Manager | Custom (Rust) | Maps user sessions to Gemini Live WebSocket connections. Handles auth, reconnection, context serialisation. |
| Gemini Live Bridge | `tokio-tungstenite` | Maintains persistent WebSocket to `generativelanguage.googleapis.com`. Manages the bi-directional audio/text stream. Translates Gemini function calls into Rig pipeline invocations. |
| Agent Orchestrator | `rig-core` | Defines agent pipelines for each sub-agent type. Uses Rig's parallelisation and orchestrator-worker patterns. |
| Entity Extraction | `rig-core` (prompt chain) | Structured output extraction from page content → entity graph nodes. |
| Knowledge Graph | `rig-surrealdb` | Stores entities, relationships, embeddings. Supports semantic search and graph traversal. |
| Embedding | Rig embedding API (OpenAI or Gemini) | Generates vector embeddings for entities and claims for semantic similarity. |

#### Gemini Live Integration Detail

The Gemini Live API is configured with function declarations at session setup:

```json
{
  "setup": {
    "model": "models/gemini-live-2.5-flash-native-audio",
    "generationConfig": {
      "responseModalities": ["AUDIO", "TEXT"],
      "speechConfig": {
        "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": "Puck" } }
      }
    },
    "systemInstruction": "You are Verity, a media literacy copilot...",
    "tools": [
      {
        "functionDeclarations": [
          {
            "name": "analyze_page",
            "description": "Analyze the current page for bias, omissions, and framing",
            "parameters": { "type": "object", "properties": { "url": { "type": "string" }, "content": { "type": "string" } } }
          },
          {
            "name": "verify_claim",
            "description": "Verify a specific claim against multiple sources",
            "parameters": { "type": "object", "properties": { "claim": { "type": "string" }, "source_url": { "type": "string" } } }
          },
          {
            "name": "profile_source",
            "description": "Research the funding, ownership, and reliability of a news source",
            "parameters": { "type": "object", "properties": { "source_name": { "type": "string" } } }
          },
          {
            "name": "find_perspectives",
            "description": "Find coverage of this story from different countries and cultures",
            "parameters": { "type": "object", "properties": { "topic": { "type": "string" }, "regions": { "type": "array", "items": { "type": "string" } } } }
          },
          {
            "name": "query_knowledge_graph",
            "description": "Search the user's accumulated knowledge graph for related entities",
            "parameters": { "type": "object", "properties": { "query": { "type": "string" } } }
          }
        ]
      },
      { "googleSearch": {} }
    ]
  }
}
```

When Gemini decides it needs to verify a claim, it emits a `toolCall` message. The Verity Core Service intercepts this, dispatches it to the Rig orchestrator, and returns the result as a `toolResponse` — all while the voice session stays open.

### 5.4 Data Flow: Page Load → Voice Response

```
1. User navigates to article
       │
2. Extension captures DOM text + metadata
       │
3. WASM module extracts clean article body, pre-tags entities
       │
4. Sends { url, content, candidate_entities } to Core Service via WS
       │
5. Core Service injects page content into Gemini Live session context
       │
6. Gemini evaluates content against system instructions
       │
7a. [Sentinel mode] If bias/omission signal detected:
       │   Gemini speaks proactive alert to user
       │
7b. [Any mode] If user asks a question:
       │   Gemini reasons, may issue function calls:
       │
       ├──→ verify_claim("unemployment fell 2%")
       │         │
       │         ▼
       │    Rig orchestrator fans out:
       │    ├── Fact-check DB lookup
       │    ├── Search for primary data (BLS, ONS, etc.)
       │    └── Search for contradicting sources
       │         │
       │         ▼
       │    Results synthesised, uncertainty-calibrated
       │    Returned to Gemini as function response
       │
       ├──→ profile_source("Daily Example")
       │         │
       │         ▼
       │    Source Profiler sub-agent:
       │    ├── Ownership/funding lookup
       │    ├── Media Bias/Fact Check cross-ref
       │    └── Historical reliability scoring
       │
       └──→ find_perspectives("housing crisis", ["DE", "JP", "BR"])
                 │
                 ▼
            Perspective Scout sub-agents (parallel, one per region):
            ├── Search local-language sources
            ├── Translate & summarise
            └── Identify framing divergences
       │
8. Gemini synthesises all function responses into spoken answer
       │
9. Entities from all results fed into knowledge graph
       │
10. Dashboard receives graph update via WS push
```

### 5.5 Rig Agent Pipeline Examples

```rust
// Conceptual — Claim Verification Pipeline using Rig patterns

use rig::pipeline::{self, agent_fn};
use rig::providers::google; // or openai

async fn verify_claim(claim: &str, source_url: &str) -> VerificationResult {
    let client = google::Client::from_env();

    // Stage 1: Decompose claim into verifiable sub-claims
    let decomposer = client.agent("gemini-2.5-flash")
        .preamble("Break this claim into individually verifiable factual sub-claims...")
        .build();

    // Stage 2: Search for evidence (parallel per sub-claim)
    // Uses Rig's parallelisation pattern
    let sub_claims: Vec<SubClaim> = decomposer
        .extract(claim)
        .await?;

    let evidence: Vec<Evidence> = futures::future::join_all(
        sub_claims.iter().map(|sc| search_evidence(sc))
    ).await;

    // Stage 3: Evaluate — orchestrator-worker pattern
    let evaluator = client.agent("gemini-2.5-flash")
        .preamble("Given the claim and evidence, assess... Use calibrated uncertainty...")
        .build();

    let verdict = evaluator
        .prompt(&format!(
            "Claim: {}\nEvidence: {:?}\nSource: {}",
            claim, evidence, source_url
        ))
        .await?;

    // Stage 4: Epistemic guardrail check
    apply_guardrails(verdict)
}
```

```rust
// Conceptual — Parallel Source Profiling

async fn profile_source(source_name: &str) -> SourceProfile {
    let (ownership, bias_rating, historical) = tokio::join!(
        lookup_ownership(source_name),         // sub-agent 1
        lookup_bias_rating(source_name),        // sub-agent 2
        lookup_historical_accuracy(source_name) // sub-agent 3
    );

    SourceProfile {
        name: source_name.to_string(),
        ownership: ownership?,
        bias_rating: bias_rating?,
        historical_accuracy: historical?,
        confidence: compute_confidence(&[&ownership, &bias_rating, &historical]),
    }
}
```

### 5.6 Why This Stack

| Decision | Rationale |
|---|---|
| **Rust + Rig for outer loop** | Type-safe agent pipelines, zero-cost abstractions for parallel sub-agent fan-out, predictable latency under `tokio`, no GC pauses during real-time audio proxying. Rig provides battle-tested patterns (prompt chaining, parallelisation, orchestrator-worker) out of the box. |
| **Rust → WASM for client** | Keeps latency-sensitive pre-processing (DOM parsing, entity pre-extraction, audio encoding) in the browser without a network round-trip. Shares types/logic with the server crate via a common `verity-core` library crate. |
| **Gemini Live for inner loop** | Native audio processing (no STT→LLM→TTS pipeline), sub-second latency, built-in VAD and barge-in, affective dialogue, function calling for tool dispatch, Google Search grounding. WebSocket-native. |
| **SurrealDB for graph** | Unified document + graph + vector store in a single engine. Native Rust, first-class Rig integration via `rig-surrealdb`. Graph traversal for relationship queries, vector search for semantic entity matching, document store for raw page snapshots. |
| **TypeScript + React for frontend** | Ecosystem maturity for Chrome extensions (Manifest V3), rich visualisation libraries (D3, force-graph), Web Audio API integration. WASM modules integrate cleanly via `wasm-pack` npm packages. |

### 5.7 Crate / Package Structure

```
verity/
├── crates/
│   ├── verity-core/           # Shared types, entity models, graph schema
│   │                          # Compiled for both native and wasm32 targets
│   ├── verity-client/         # WASM module (DOM extraction, audio encoding)
│   │                          # Depends on verity-core
│   │                          # Built with wasm-pack → npm package
│   ├── verity-server/         # Axum server, Gemini bridge, session mgmt
│   │                          # Depends on verity-core, rig-core, rig-surrealdb
│   ├── verity-agents/         # Rig agent pipeline definitions
│   │                          # Sub-agents: source profiler, claim verifier, etc.
│   │                          # Depends on verity-core, rig-core
│   └── verity-graph/          # Knowledge graph abstraction over SurrealDB
│                              # Depends on verity-core, rig-surrealdb
├── extension/                 # Chrome extension (TypeScript, Manifest V3)
│   ├── src/
│   │   ├── content.ts         # Content script — captures page DOM
│   │   ├── background.ts     # Service worker — manages WS connection
│   │   └── popup.tsx          # Extension popup UI
│   └── pkg/                   # wasm-pack output (verity-client)
├── dashboard/                 # React SPA (TypeScript)
│   ├── src/
│   │   ├── components/
│   │   │   ├── GraphView.tsx  # D3 force-directed knowledge graph
│   │   │   ├── Timeline.tsx   # Topic narrative timeline
│   │   │   ├── SourceCard.tsx # Source reliability card
│   │   │   └── VoicePanel.tsx # Audio controls + transcript
│   │   └── hooks/
│   │       ├── useVerityWS.ts # WebSocket connection hook
│   │       └── useGraph.ts    # Graph state management
│   └── package.json
├── Cargo.toml                 # Workspace root
└── docker-compose.yml         # SurrealDB + Verity server
```

---

## 6. Open Questions

- **Privacy model:** The knowledge graph contains a detailed map of the user's information diet. Where is it stored? Who can access it? How is it encrypted at rest? End-to-end encryption feasibility with a server-side graph store.
- **Gemini Live session limits:** Default 10-minute session window. How gracefully can context be carried across reconnections? What is the maximum content injection size per turn?
- **Rig + Gemini provider support:** Rig currently lists OpenAI, Cohere, and others. Verify the maturity of Gemini/Google provider support in Rig, or plan for a custom `CompletionModel` trait implementation.
- **WASM binary size:** Entity pre-extraction and DOM parsing may inflate the WASM bundle. Budget target: <2MB gzipped. May need to split into lazy-loaded modules.
- **Sub-agent cost management:** Parallel fan-out can generate significant API usage. Throttling, caching, and per-query budget caps needed.
- **Source reliability scoring:** Static databases (Media Bias/Fact Check) vs. dynamically computed scores vs. hybrid. How to handle outlets not in any database.
- **False-equivalence calibration:** Who or what determines when balance tips into false equivalence? This is the hardest editorial judgement the system makes — needs a transparent, auditable rubric.
- **Audio latency budget:** End-to-end target: user speaks → Verity responds in <2 seconds. Profile: WASM audio encode (~5ms) + WS to server (~20ms) + server to Gemini (~10ms) + Gemini processing (~500-1500ms) + return path. Tight but feasible.

---

## 7. Development Phases

| Phase | Scope | Key Deliverables |
|---|---|---|
| **Phase 1 — Voice Analyst** | Voice interface + page parsing + basic bias flagging. Single-user, single-session. | Rust server with Gemini Live bridge, Chrome extension with DOM capture, basic system prompt for bias detection. |
| **Phase 2 — Entity Graph** | Entity extraction loop, persistent knowledge graph, cross-session memory. | `verity-agents` entity extraction pipeline, SurrealDB integration, WASM client module, graph diff sync. |
| **Phase 3 — Sub-Agents** | Parallel research fan-out, source profiling, claim verification, multi-language perspective sourcing. | Full Rig orchestrator-worker pipelines, Perspective Scout with translation, epistemic guardrail evaluator. |
| **Phase 4 — Dashboard** | Visual intelligence dashboard, trend tracking, alerting. | React SPA with D3 force graph, topic timelines, source reliability cards, real-time WS updates. |