# Reference: verity-phase-1-voice-analyst-ts

## Purpose
High-signal working brief distilled from the existing product notes for turning the concept into a bounded Phase 1 implementation plan.

## Product Direction

### Verity product notes
- Source: `notes.md`
- Why it matters: This is the only authoritative product source currently in the repo and defines the product vision, core capabilities, architecture intent, and staged roadmap.
- Focus areas:
  - `## 2. Core Capabilities` for which capabilities belong in the long-term product and which should be deferred from the first slice
  - `## 3. Moral & Epistemic Framework` for tone, uncertainty handling, and false-equivalence constraints
  - `## 4. Interaction Model` for the voice-first modes and user prompts
  - `## 5. Technical Architecture` for the proposed extension, WASM, Rust service, and orchestration boundaries
  - `## 7. Development Phases` for the natural task boundary of an initial implementation milestone
- Notes:
  - The notes describe a broad product spanning four phases, but Phase 1 already provides a natural vertical slice: voice interface, page parsing, and basic bias flagging.
  - The distinctive product behavior is not only "analyse web pages" but doing so with epistemic restraint: uncertainty-first language, no ideological moralising, and no false equivalence when evidence is one-sided.
  - The proposed architecture separates a latency-sensitive inner voice loop from heavier outer-loop analysis and later fan-out work; for the first slice, only the minimum required subset should be implemented.
  - Later capabilities such as persistent graph memory, sub-agent fan-out, and dashboard views should influence boundaries now but remain deferred from the first milestone.
- Useful anchors:
  - `### 2.1 Real-Time Page Analysis`
  - `### 3.2 Balanced Without False Equivalence`
  - `### 3.3 Uncertainty-First Language`
  - `### 4.2 Proactive vs. Reactive Modes`
  - `### 5.2 The Two Loops`
  - `## 7. Development Phases`

## Gemini Live Runtime Pattern

### Gemini Live implementation reference
- Source: `dev/geminilive-reference.md`
- Why it matters: This is now the primary implementation reference for the runtime architecture, session loop, tool wiring, audio handling, and outer orchestration boundary.
- Focus areas:
  - `## Recommended Architecture` for the three-layer split between live interaction, tool execution, and outer orchestration
  - `## The Core Agent Loop` for the queue-based inbound message processor
  - `## Bootstrapping a Live Session` for session setup and callback structure
  - `## Voice Input Pipeline` and `## Assistant Audio Output` for browser audio handling
  - `## Tool Calling Architecture` for declarative tool schemas and runtime executors
  - `## The Outer Loop` for async job boundaries and long-running work
- Notes:
  - The strongest durable pattern is an event-driven queue processor rather than ad hoc websocket callback handling.
  - The live session should stay focused on low-latency interaction and immediate tool use; slower analysis should move behind async job tools when needed.
  - Text input should remain available even in a voice-first product because it improves debugging, accessibility, and deterministic testing.
  - State should be explicit and session-scoped: setup completion, listening/speaking state, transcript accumulation, and playback lifecycle should not be inferred from UI alone.
  - The reference argues for TypeScript-native implementations of the browser loop, tool registry, and orchestration surface, which aligns with the new decision to avoid Rust entirely.
- Useful anchors:
  - `## Recommended Architecture`
  - `## The Core Agent Loop`
  - `## Bootstrapping a Live Session`
  - `## Tool Calling Architecture`
  - `## State Machine Recommendation`
  - `## A Good Default Blueprint`

## Architecture Constraints

### Greenfield repo reality
- Source: repository working tree
- Why it matters: The repo currently contains product notes only, so the plan must bootstrap a codebase rather than integrate with existing code.
- Focus areas:
  - No existing Rust workspace, browser extension, frontend app, or generated context files
  - Git history includes a deleted legacy `SCOPE.md`, but the current working material is `notes.md`
- Notes:
  - Because the repo is nearly empty, planning must distinguish clearly between current state and proposed architecture.
  - The plan should avoid pretending there is existing infrastructure for backend services, orchestration storage, or frontend build tooling.
  - The first milestone should create only the minimum scaffolding required to demonstrate the product loop end to end.
- Useful anchors:
  - Working tree root
  - `git status --short`

### TypeScript-only implementation constraint
- Source: user directive in the current session
- Why it matters: This is a hard implementation boundary and overrides earlier planning assumptions about Rust services or shared Rust/WASM code.
- Focus areas:
  - browser runtime in TypeScript
  - TypeScript service or server layer for non-secret orchestration and optional token brokering
  - shared TypeScript types instead of language-bridging models
- Notes:
  - Any previous references to Rust backend, Rust crates, or WASM preprocessing should be treated as obsolete for this task.
  - If client-side extraction is needed, it should be implemented directly in TypeScript first unless performance data later justifies a different approach.
- Useful anchors:
  - `dev/0_SCOPE.md`

## Planning Inputs

### Open questions from the notes
- Source: `notes.md`, `## 6. Open Questions`
- Why it matters: These questions identify where the product concept still contains risk or unresolved implementation detail.
- Focus areas:
  - Privacy model
  - Gemini session limits and context carryover
  - Rig + Gemini provider support
  - WASM bundle size
  - Cost management and source scoring
  - False-equivalence calibration rubric
  - Audio latency budget
- Notes:
  - Most of these should not block the first planning package if the scope is narrowed to a single-user Phase 1 slice.
  - The riskiest items for the first implementation are provider maturity, voice latency, and how much page content can be injected per turn.
  - The rest can be captured as spikes or deferred decisions rather than treated as blockers.
- Useful anchors:
  - `## 6. Open Questions`

## Reference Codebases
None. No local implementation exists yet, and no external reference repo was required for this planning pass.

## Synthesis
The notes still imply the right first milestone: ship a narrow "Voice Analyst" slice that proves page capture, live conversational analysis, and Verity's epistemic voice. The Gemini Live reference supplies the concrete TypeScript runtime pattern: queue-driven live session management, a narrow tool layer, explicit state machines, and an optional async orchestration boundary. Planning should resist building the graph, sub-agent fan-out, or dashboard up front, but the repo shape should leave explicit extension points for those later phases.

## Open Threads
- Confirm whether Gemini Live remains the intended real-time provider at implementation time.
- Decide whether the initial browser surface is a Chrome extension popup, side panel, or background-driven voice session.
- Decide whether the first slice includes proactive Sentinel nudges or starts with on-demand analysis only.
