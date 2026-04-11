# Reference: refresh-dev-docs-to-current-architecture

## Purpose
High-signal source map for rewriting the `dev/` artifacts around the architecture that is actually implemented today.

## Current Implementation Sources

### Repository entrypoint and developer workflow
- Source: `README.md`
- Why it matters: This is the clearest high-level description of the current source layout, local run flow, environment variables, and intended product surface.
- Key points:
  - The repo uses one top-level `src/` tree rather than `packages/*` or Rust crates.
  - `bun run dev` starts the Next.js UI and Hono API together.
  - The UI is transcript-first and centered on one Gemini Live voice session plus screen share.
  - The documented Live API conventions already align with the current code: ephemeral tokens, `sendRealtimeInput`, and connect-time config.

### Architecture summary
- Source: `docs/architecture.md`
- Why it matters: This file already captures the simplified implementation shape and confirms that older package-oriented documentation is obsolete.
- Key points:
  - Current implementation lives in `src/core`, `src/app`, `src/lib`, `src/server`, and `scripts`.
  - `.env` controls ports, origins, and API base URLs.
  - `docs/PDR.md` remains broader product direction, not the active implementation shape.

### Shared domain and deterministic core
- Source: `src/core/index.ts`
- Why it matters: This file is the authoritative definition of current shared types, runtime constants, deterministic analysis behavior, fixture data, and Gemini Live config defaults.
- Key points:
  - Shared types include `PageContext`, `AnalysisRequest`, `AnalysisResponse`, `SessionState`, `LiveConfigSummary`, and token/config response types.
  - Current analysis is deterministic local logic, not LLM-backed server reasoning.
  - Epistemic behavior is implemented as explicit helper logic and fixture assertions, not only as prompt prose.
  - Live defaults include audio responses, one FPS video frames, context-window compression, session resumption, and automatic activity detection settings.

### Browser-side live session runtime
- Source: `src/lib/live-session.ts`
- Why it matters: This file is the primary implementation reference for the current Live API pattern.
- Key points:
  - The browser fetches an ephemeral token from `POST /live/token`.
  - The browser opens `ai.live.connect(...)` directly.
  - Session state is explicit and surfaced through snapshots.
  - Inbound server messages are serialized through an `AsyncQueue`.
  - Runtime text, audio, video, and audio-end markers all go through `sendRealtimeInput`.
  - The system instruction is built from the current `PageContext`.

### Browser UI and media capture
- Source: `src/app/page.tsx`
- Why it matters: This file shows how the actual product surface behaves today.
- Key points:
  - The user starts one live session from the browser UI.
  - Screen share is captured via `getDisplayMedia`, rendered to a canvas, JPEG-encoded, and sent at one frame per second.
  - Microphone input is captured via `getUserMedia`, downsampled to 16 kHz PCM, and streamed live.
  - Assistant audio is received as PCM bytes and played back in the browser.
  - Optional page URL/title fields are hints; the intended grounding path is the live screen and voice stream.

### API server
- Source: `src/server/index.ts`
- Why it matters: This file defines the current backend boundary and makes the implemented responsibilities unambiguous.
- Key points:
  - The API is a standalone Hono server.
  - It exposes `/health`, `/fixtures`, `/live/config`, `/live/token`, `/validate`, and `/analyze`.
  - The server handles CORS and environment normalization.
  - The server brokers ephemeral Gemini tokens if `GEMINI_API_KEY` is present.
  - `POST /analyze` currently routes to deterministic local analysis helpers from `src/core`.

### Environment and launch helpers
- Sources: `.env.example`, `scripts/run-workspace.ts`, `scripts/kill-dev-ports.ts`
- Why they matter: These files define how the repo is actually run and where the docs need to be precise.
- Key points:
  - Web and API ports are distinct and loaded from repo-root `.env`.
  - `run-workspace.ts` injects the correct `PORT` per target.
  - `kill-dev-ports.ts` is best-effort and effectively macOS/Linux-focused; on Windows it warns and skips process cleanup.

## Product-Direction Sources

### Product notes and PDR
- Sources: `notes.md`, `docs/PDR.md`
- Why they matter: These still describe the broader Verity vision, but much of their architecture is not yet implemented.
- Key points:
  - They are useful for roadmap intent, epistemic stance, and longer-term product language.
  - They are not authoritative for current code structure.
  - They still contain older assumptions such as browser extension capture, dashboard surfaces, research fan-out, graph persistence, Rust/WASM modules, and broader multi-agent orchestration.

### Gemini Live reference
- Source: `dev/geminilive-reference.md`
- Why it matters: This remains a strong pattern reference for the current live session architecture.
- Key points:
  - Queue-driven message processing matches the implemented `AsyncQueue` pattern.
  - Explicit state handling and browser-managed audio pipelines align with current code.
  - Tool-calling and outer-loop orchestration guidance are still mostly future-facing for this repo.

## Synthesis
The current codebase has already converged on a much simpler and more concrete architecture than the older `dev/` docs describe. The durable implementation pattern is: one TypeScript repo, one browser UI, one Hono API, shared types and helper logic in `src/core`, and a browser-owned Gemini Live session grounded by screen share and microphone input. Deterministic analysis helpers currently stand in for the broader research and orchestration ideas still described in product-direction documents.

## Open Threads
- Whether future work will keep the browser-owned live connection or move session ownership back behind a stronger server boundary.
- Whether deterministic `POST /analyze` logic remains a local validation aid or evolves into a richer structured analysis pipeline.
- How much of the broader product vision should stay in `dev/` versus living only in product docs.
