# Verity Architecture

## Purpose

Verity is currently a TypeScript-only Phase 1 "voice analyst" slice. The system combines:

- a Next.js browser client in `src/app`
- a browser-side Gemini Live session manager in `src/lib`
- a Hono API server in `src/server`
- a shared domain and policy layer in `src/core`

The durable architectural goal is a realtime loop where the browser streams voice and screen context into a Gemini Live session, while the server brokers credentials and the shared core preserves product semantics, contracts, and analysis rules.

## Durable Decisions

These decisions appear intentional and should be treated as architectural constraints until explicitly changed.

1. TypeScript-only runtime
Verity's executable path is entirely TypeScript. `src/core`, `src/lib`, `src/server`, and `src/app` are the stable units of composition.

2. Shared domain model in `src/core`
All cross-boundary types and stable runtime constants live in `src/core/index.ts`. Browser and server both import from this module instead of redefining payloads.

3. Live interaction is browser-owned
The browser owns microphone capture, screen-share capture, transcript rendering, audio playback, and Gemini Live websocket session lifecycle through `createLiveSessionManager()`.

4. Credential minting is server-owned
Long-lived Gemini credentials stay on the server. The browser requests short-lived ephemeral tokens from `POST /live/token`.

5. Queue-driven live message processing
Inbound Gemini Live events are serialized through `AsyncQueue<LiveServerMessage>` in `src/lib/live-session.ts`. This is the core concurrency contract for the realtime session loop.

6. Runtime input uses `sendRealtimeInput`
Typed text, PCM audio, and JPEG video frames are all sent as runtime input through `sendRealtimeInput(...)`. The architecture is aligned to Gemini Live 3.1 conventions.

7. Deterministic local analysis remains available
`src/server/index.ts` exposes `/analyze`, `/fixtures`, and `/validate` backed by `analyzePage()` in `src/core`. This gives the codebase a non-live validation path for product behavior and guardrails.

8. Epistemic behavior is code, not prompt-only
Calibrated uncertainty, omission analysis, and false-balance avoidance are encoded in deterministic analysis logic and in the live system instruction builder.

9. Phase 1 excludes persistence and orchestration
There is no durable storage, job system, knowledge graph, or research fan-out in the critical path. The current design intentionally keeps those concerns outside `src`.

## Source Map

```mermaid
flowchart LR
  UI["src/app\nNext.js client UI"] --> Live["src/lib/live-session.ts\nGemini Live session manager"]
  UI --> Core["src/core/index.ts\nshared types, config, analysis rules"]
  Live --> Core
  Live -->|POST /live/token| API["src/server/index.ts\nHono API"]
  UI -->|GET /live/config| API
  UI -->|POST /analyze| API
  API --> Core
  API -->|mint ephemeral token| Gemini["Gemini API"]
  Live -->|live.connect + realtime input| Gemini
```

## Module Responsibilities

### `src/core`

`src/core/index.ts` is the system's stable contract layer.

- Defines canonical types:
  - `PageContext`
  - `AnalysisRequest`
  - `AnalysisResponse`
  - `SessionState`
  - `LiveConfigSummary`
  - HTTP response contracts for health, live config, and token minting
- Defines runtime constants:
  - `API_DEFAULT_PORT`
  - `GEMINI_LIVE_MODEL`
  - `GEMINI_LIVE_API_VERSION`
  - `GEMINI_LIVE_VOICE`
- Encodes product policy:
  - `buildLiveSystemInstruction(page)`
  - `analyzePage(request)`
  - `createFixtureRequests()`
  - `runFixtureAssertions()`
- Supplies low-level shared utilities:
  - `AsyncQueue<T>`
  - `accumulateTranscript(...)`
  - whitespace normalization and site-name inference

Durable rule: if a payload crosses module boundaries, it should be represented here first.

### `src/lib`

`src/lib/live-session.ts` owns the browser-side live runtime.

- Connects to Gemini Live with an ephemeral token
- Builds the session config from shared core defaults
- Maintains explicit session state and transcript accumulators
- Serializes incoming `LiveServerMessage` events through `AsyncQueue`
- Emits a coarse-grained `LiveSessionSnapshot` to the UI
- Sends runtime input over four channels:
  - text
  - PCM16 audio at 16 kHz
  - JPEG video frames
  - audio stream termination

Durable rule: websocket callback handling is not spread across the UI; it is centralized here.

### `src/app`

`src/app/page.tsx` is the composition root for the browser experience.

- Fetches `/live/config` on load
- Creates and tears down the `LiveSessionManager`
- Captures screen-share frames at 1 FPS
- Captures microphone audio, downsamples it to PCM16/16kHz, and streams it
- Plays assistant audio at 24 kHz
- Renders transcript history and live partial transcripts
- Builds the session's initial `PageContext`

Durable rule: the UI is a thin orchestration surface over the live session manager rather than a second protocol implementation.

### `src/server`

`src/server/index.ts` is a narrow HTTP boundary.

- Exposes health and validation endpoints
- Publishes live client configuration
- Mints ephemeral Gemini tokens from the server-side API key
- Normalizes analysis requests and returns deterministic analysis results
- Enforces a basic environment invariant: `WEB_PORT` and `API_PORT` must differ

Durable rule: server concerns are HTTP contracts and credential brokerage, not browser session state.

## Runtime Flows

### Realtime Session Flow

```mermaid
sequenceDiagram
  participant User
  participant UI as Browser UI
  participant Live as LiveSessionManager
  participant API as Hono API
  participant Gemini as Gemini Live

  User->>UI: Start session
  UI->>Live: connect(PageContext)
  Live->>API: POST /live/token
  API-->>Live: LiveTokenHttpResponse
  Live->>Gemini: live.connect(config + system instruction)
  Gemini-->>Live: streaming server messages
  Live-->>UI: LiveSessionSnapshot updates

  User->>UI: Share screen + allow mic
  UI->>Live: sendVideoFrame(base64Jpeg) every 1s
  UI->>Live: sendAudioChunk(base64Pcm16)
  User->>UI: Optional typed message
  UI->>Live: sendText(text)

  Gemini-->>Live: transcription + model parts + turnComplete
  Live-->>UI: partial/final transcript + state updates
  Live-->>UI: assistant audio chunks
  UI->>User: audio playback + transcript rendering
```

### Internal Message Handling

```mermaid
flowchart TD
  Msg["Gemini Live callbacks"] --> Queue["AsyncQueue<LiveServerMessage>"]
  Queue --> Processor["processMessages() loop"]
  Processor --> Resumption["update resumeHandle"]
  Processor --> UserTx["accumulate user transcript"]
  Processor --> AssistantTx["accumulate assistant transcript"]
  Processor --> Audio["forward inline audio to onAudioChunk"]
  Processor --> State["update SessionState"]
  Processor --> Snapshot["emitSnapshot()"]
```

The queue is the main durability point in the design. It prevents websocket callback races from leaking directly into UI state mutation.

## Contracts

### Core Domain Types

```mermaid
classDiagram
  class PageContext {
    +string url
    +string|null title
    +string|null siteName
    +string|null publishedAt
    +string contentText
    +string|null selectionText
  }

  class AnalysisRequest {
    +PageContext page
    +AnalysisMode mode
    +string userPrompt
  }

  class AnalysisResponse {
    +string summary
    +string[] biasSignals
    +string[] missingContext
    +string[] confidenceNotes
    +string[] followUpPrompts
    +string|null groundedQuote
    +SessionState sessionState
  }

  class LiveSessionSnapshot {
    +SessionState state
    +string partialUserTranscript
    +string partialAssistantTranscript
    +string|null resumeHandle
    +string|null lastError
    +number turnCompleteCount
    +boolean isConnected
  }

  AnalysisRequest --> PageContext
  AnalysisResponse --> PageContext : grounded to
```

### HTTP API Contracts

The current HTTP surface is intentionally small.

| Method | Path | Request | Response | Purpose |
|---|---|---|---|---|
| `GET` | `/health` | none | `HealthResponse` | Service liveness and workspace identity |
| `GET` | `/fixtures` | none | `{ ok, fixtures }` | Returns deterministic fixture requests |
| `GET` | `/live/config` | none | `LiveConfigHttpResponse` | Publishes client-visible live configuration |
| `POST` | `/live/token` | none | `LiveTokenHttpResponse` | Mints a single-use ephemeral token |
| `GET` | `/validate` | none | `{ ok, results }` | Runs fixture assertions |
| `POST` | `/analyze` | partial `AnalysisRequest` | `AnalyzeHttpResponse` | Deterministic page analysis |

Durable rule: browser-facing contracts are typed in `src/core` and implemented in `src/server`.

### Live Session Manager Contract

`createLiveSessionManager(options)` returns an object with the following stable surface:

- `connect(page: PageContext): Promise<void>`
- `sendText(text: string): void`
- `sendAudioChunk(base64Pcm16: string): void`
- `sendAudioStreamEnd(): void`
- `sendVideoFrame(base64Jpeg: string): void`
- `close(): void`
- `getSnapshot(): LiveSessionSnapshot`

This is the main abstraction boundary between `src/app` and Gemini Live.

## Data Model

### Canonical Page Model

`PageContext` is the primary data object flowing through the system.

- `url` is required and is the identity anchor for the viewed page
- `title`, `siteName`, and `publishedAt` are optional metadata
- `contentText` is the main deterministic analysis substrate
- `selectionText` is optional focus context layered on top of the page body

Durable rule: both live and deterministic analysis are page-grounded.

### Analysis Model

`AnalysisRequest` combines:

- a normalized `PageContext`
- `mode`, currently one of `on_demand | analyst | sentinel`
- `userPrompt`

`AnalysisResponse` returns:

- one `summary`
- structured rationale arrays for bias, missing context, and confidence
- suggested follow-ups
- one `groundedQuote`
- a `sessionState` marker

Durable rule: analysis output is structured first and natural-language second.

### Session State Model

The explicit session-state enum is:

- `disconnected`
- `connecting`
- `connected`
- `listening`
- `processing`
- `speaking`
- `error`

```mermaid
stateDiagram-v2
  [*] --> disconnected
  disconnected --> connecting: connect()
  connecting --> connected: websocket open
  connected --> listening: setup ready
  listening --> processing: sendText()
  listening --> speaking: model output begins
  processing --> speaking: model output begins
  speaking --> listening: turnComplete
  speaking --> listening: interrupted
  connecting --> error: connect failure
  listening --> error: transport/runtime failure
  speaking --> error: transport/runtime failure
  error --> disconnected: close()
  listening --> disconnected: close()
  speaking --> disconnected: close()
```

Durable rule: operational state is explicit and transport-driven, not inferred from transcript text or button state.

## Boundary Rules

### Browser vs Server

Browser-owned:

- microphone permission and capture
- screen-share permission and capture
- local playback of assistant audio
- transcript presentation
- live Gemini session lifecycle

Server-owned:

- long-lived Gemini credential storage
- ephemeral token creation
- deterministic validation and analysis endpoints
- coarse HTTP configuration surface

### Core vs Application Logic

Core-owned:

- shared types
- stable constants
- deterministic product rules
- prompt/system-instruction composition helpers

Application-owned:

- DOM APIs
- React state
- media capture/playback
- HTTP wiring
- API process bootstrap

## Extension Path

The current code is already shaped for later expansion without rewriting the Phase 1 loop.

Likely future additions that fit the current architecture:

- tool declarations added at live session connect time
- server-side orchestration tools behind the existing API boundary
- persistent storage layered behind `src/server` without changing `PageContext`
- richer analysis engines reusing `AnalysisRequest` and `AnalysisResponse`

Likely breaking changes:

- moving live session ownership from browser to server
- replacing `PageContext` as the primary grounding object
- removing the queue-driven message processor
- embedding long-lived credentials in the browser

## Non-Goals In Current Architecture

The following are intentionally absent from `src` today:

- durable memory or knowledge graph storage
- multi-user session management
- async job orchestration
- background worker fleet
- research fan-out or retrieval pipelines
- production-grade observability and policy enforcement

Their absence is a feature of the current architecture, not a gap in the document.

## Files To Revisit When Architecture Changes

- [src/core/index.ts](</C:/Users/ruari/Storage/Code/verity/src/core/index.ts>)
- [src/lib/live-session.ts](</C:/Users/ruari/Storage/Code/verity/src/lib/live-session.ts>)
- [src/app/page.tsx](</C:/Users/ruari/Storage/Code/verity/src/app/page.tsx>)
- [src/server/index.ts](</C:/Users/ruari/Storage/Code/verity/src/server/index.ts>)

When a future change alters boundaries, data contracts, or ownership, update this document alongside those files.
