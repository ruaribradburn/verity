# Analysis: refresh-dev-docs-to-current-architecture

## Current State
- The repo is no longer greenfield. It already contains a working single-tree TypeScript implementation.
- `src/app/page.tsx` provides the only current product surface: a Next.js client page for starting one live Gemini session, sharing the screen, streaming microphone audio, and sending optional typed messages.
- `src/lib/live-session.ts` owns the browser-side Gemini Live session manager, token fetch, queue-based message processing, transcript accumulation, and snapshot state.
- `src/server/index.ts` is a Hono API that provides health/config/token endpoints plus deterministic local analysis and fixture validation endpoints.
- `src/core/index.ts` is the current shared architecture center: types, runtime constants, system instruction construction, deterministic analysis logic, fixture generation, and validation helpers.

## Mismatch With Existing `dev/` Docs

| Area | Stale docs say | Current code does | Required correction |
|------|----------------|-------------------|---------------------|
| Repo maturity | Greenfield implementation plan | Working app and API already exist | Rewrite as current-state docs, not build plan |
| Repo structure | Planned `extension/`, `server/`, `shared/`, dashboard, future workspaces | One top-level `src/` tree plus `scripts/` | Document actual directories only |
| Runtime ownership | Broader extension or backend-led session loop | Browser opens Gemini Live directly after fetching token from API | Make browser-owned session explicit |
| Backend role | Larger orchestration surface | Hono token broker + deterministic helper API | Narrow the server docs to implemented responsibilities |
| Analysis path | Implied richer live analysis/backend orchestration | Deterministic helper logic in `src/core` plus fixture assertions | Distinguish implemented deterministic path from future orchestration |
| Product scope | Phase-1 implementation roadmap for a broader system | Live screen-share + voice analyst slice already implemented | Shift docs from planning future build to describing current slice |
| Technology assumptions | Rust/WASM/extension/dashboard remained deferred implementation detail | Those paths are absent from runtime code | Move them to future-direction context only |

## Architectural Pattern Now Evident In Code
- Shared constants and domain types live in `src/core`, not in a separate package.
- The browser is responsible for session startup, media capture, and direct Gemini Live transport.
- The API is intentionally thin:
  - CORS and env normalization
  - ephemeral-token brokering
  - local config exposure
  - deterministic analysis fixtures and validation
- The current grounding model is multimodal but lightweight:
  - page metadata hint at connect time
  - live screen frames at one FPS
  - live microphone audio at 16 kHz PCM
  - assistant audio playback in-browser at 24 kHz PCM
- The epistemic stance is reinforced in two places:
  - deterministic local analysis helpers and fixtures
  - connect-time system instruction sent to Gemini Live

## Documentation Consequences
- `dev/` should stop reading like a pre-implementation artifact package and start reading like a living architecture snapshot.
- Product-direction files such as `notes.md` and `docs/PDR.md` should be treated as aspirational context, not primary implementation authority.
- Future-facing items still matter, but they must be labeled as deferred or speculative:
  - multi-agent orchestration
  - knowledge graph persistence
  - extension capture
  - dashboard UI
  - broader connector-based research

## Resolved Assumptions
- The current implementation is intentionally TypeScript-only.
- The current browser surface is a Next.js page, not a browser extension.
- Gemini Live session ownership currently belongs in the browser, not the backend.
- The current server-side analysis path is deterministic local logic rather than a second live-model runtime.
- `dev/geminilive-reference.md` is still useful, but only the queue/state/browser-pipeline patterns are currently implemented.

## Unresolved Unknowns
- Whether the browser-owned live connection remains the final architecture once auth, reliability, or session-resume requirements grow.
- Whether the deterministic analysis endpoint is a temporary validation aid or the seed of a more structured analysis service.
- Whether future proactive Sentinel behavior should live entirely in the browser session loop or involve stronger backend orchestration.

## Blockers
None. The current codebase is coherent enough to support a full documentation refresh.

## Intentionally Deferred
- Any architectural commitments around graph storage, multi-tab ingestion, backend research connectors, or sub-agent fan-out.
- Rewriting `notes.md`, `docs/PDR.md`, or `docs/architecture.md` in this task.
- Converting future-direction concepts into present-tense implementation claims.
