# Specification: refresh-dev-docs-to-current-architecture

## User Stories
- As a contributor, I want the `dev/` artifacts to describe the code that actually exists so I can reason about the system without first reverse-engineering mismatches.
- As a developer working on Gemini Live behavior, I want the docs to make session ownership, auth flow, and runtime media handling explicit so future changes start from the correct boundary.
- As a maintainer, I want the docs to separate implemented architecture from future product direction so roadmap ideas do not get mistaken for shipped behavior.

## Requirements

### R1: Current repo topology
- Requirement: The `dev/` docs shall describe the repo as a single TypeScript application rooted in `src/` with supporting `scripts/`, rather than as a greenfield workspace or Rust-backed multi-package system.
- Priority: Must
- Satisfies: A1
- Acceptance test: Read the docs and confirm the named implementation directories match the current working tree.

### R2: Live session ownership and auth
- Requirement: The `dev/` docs shall state that the browser fetches an ephemeral token from `POST /live/token` and then opens the Gemini Live session directly from `src/lib/live-session.ts`.
- Priority: Must
- Satisfies: A2
- Acceptance test: Compare the docs with `src/lib/live-session.ts` and `src/server/index.ts` and confirm the flow matches.

### R3: Runtime media path
- Requirement: The `dev/` docs shall describe the implemented runtime media path: screen-share frames from `getDisplayMedia`, microphone capture from `getUserMedia`, browser-side PCM conversion, and runtime media submission through `sendRealtimeInput`.
- Priority: Must
- Satisfies: A2
- Acceptance test: Compare the docs with `src/app/page.tsx` and confirm the described media flow matches the code.

### R4: Deterministic local analysis path
- Requirement: The `dev/` docs shall describe `src/core` as the current home for deterministic analysis helpers, fixture generation, shared types, and local validation behavior exposed by the API.
- Priority: Must
- Satisfies: A3
- Acceptance test: Compare the docs with `src/core/index.ts` and `src/server/index.ts` and confirm the boundary is accurate.

### R5: Implemented-versus-aspirational boundary
- Requirement: The `dev/` docs shall clearly label product-direction items from `notes.md`, `docs/PDR.md`, and future-facing sections of `dev/geminilive-reference.md` as non-implemented or deferred where that is true.
- Priority: Must
- Satisfies: A4
- Acceptance test: Inspect the docs and confirm future items are described as roadmap context rather than present-tense architecture.

### R6: Accurate developer runbook references
- Requirement: The `dev/` docs shall point to the current local run and config patterns defined by `README.md`, `.env.example`, and `scripts/run-workspace.ts`.
- Priority: Should
- Satisfies: A1, A3
- Acceptance test: Follow the described bootstrap path and confirm the commands and env names exist.

### R7: Documentation-only write boundary
- Requirement: The `dev/` docs shall narrow the task write set to the `dev/` files being refreshed in this task.
- Priority: Must
- Satisfies: A5
- Acceptance test: Inspect `dev/0_SCOPE.md` and `dev/4_PLAN.md` and confirm the allowed write set is docs-only.

## Data Models

### PageContext
- `url: string`
- `title: string | null`
- `siteName: string | null`
- `publishedAt: string | null`
- `contentText: string`
- `selectionText: string | null`

### AnalysisRequest
- `page: PageContext`
- `mode: "on_demand" | "analyst" | "sentinel"`
- `userPrompt: string`

### AnalysisResponse
- `summary: string`
- `biasSignals: string[]`
- `missingContext: string[]`
- `confidenceNotes: string[]`
- `followUpPrompts: string[]`
- `groundedQuote: string | null`
- `sessionState: SessionState`

### LiveSessionSnapshot
- `state: SessionState`
- `partialUserTranscript: string`
- `partialAssistantTranscript: string`
- `resumeHandle: string | null`
- `lastError: string | null`
- `turnCompleteCount: number`
- `isConnected: boolean`

## API Contracts

### Browser -> API
- `GET /live/config`: fetch current live defaults and whether the server key is available.
- `POST /live/token`: mint an ephemeral Gemini token for browser Live API use.
- `POST /analyze`: run deterministic local analysis over a structured `AnalysisRequest`.

### API -> Browser
- `GET /health`: service status.
- `GET /fixtures`: deterministic fixture requests for local validation.
- `GET /validate`: deterministic fixture assertion results.

## Acceptance Fixtures

### F1: Architecture alignment
- Input: updated `dev/` docs plus current working tree
- Expected output shape:
  - `src/app`, `src/lib`, `src/server`, `src/core`, and `scripts` are documented.
  - No present-tense claim depends on `extension/`, Rust crates, WASM modules, or dashboard runtime code.

### F2: Live flow alignment
- Input: `src/lib/live-session.ts`, `src/app/page.tsx`, `src/server/index.ts`
- Expected output shape:
  - Docs describe token fetch from `/live/token`.
  - Docs describe browser-owned `live.connect(...)`.
  - Docs describe `sendRealtimeInput` for runtime text/audio/video.

### F3: Analysis boundary alignment
- Input: `src/core/index.ts`, `src/server/index.ts`
- Expected output shape:
  - Docs describe deterministic local analysis helpers and fixture assertions as the current implementation.
  - Docs do not claim a richer implemented backend orchestration layer than the code supports.

## Blast Radius
- User-visible impact: Low
- Data/schema impact: No
- Rollback shape: Restore previous `dev/` documents if needed; no runtime rollback required.
