# Scope: refresh-dev-docs-to-current-architecture

## Statement
Refactor the `dev/` workflow artifacts so they describe the current Verity codebase rather than the earlier greenfield architecture plan. The updated docs should reflect the implemented single-tree TypeScript app, the browser-managed Gemini Live session pattern, the Hono API token-broker and deterministic analysis endpoints, and the distinction between current runtime behavior and longer-term product direction.

## Current Session Boundaries
This task updates documentation only. No product code, runtime behavior, or API contracts are being changed in this pass.

## In Scope
- Rewrite `dev/0_SCOPE.md` through `dev/4_PLAN.md` and `dev/DECISIONS.md` to match the current repository.
- Capture the actual source layout under `src/app`, `src/lib`, `src/server`, `src/core`, and `scripts`.
- Document the current Gemini Live integration pattern:
  - browser fetches ephemeral tokens from `POST /live/token`
  - browser owns the live session connection
  - runtime media uses `sendRealtimeInput`
  - screen-share frames and microphone audio are streamed from the UI
- Document the deterministic local analysis path exposed by `POST /analyze`, `GET /fixtures`, and `GET /validate`.
- Clarify which ideas remain aspirational product direction from `notes.md` / `docs/PDR.md` rather than implemented architecture.

## Out of Scope
- Refactoring product code in `src/` or `scripts/`.
- Reintroducing the older Rust, WASM, extension, dashboard, or multi-agent architecture into the current implementation docs.
- Expanding the product scope beyond what is already present in the repo.
- Turning product-direction documents into implementation commitments.

## Acceptance Criteria
- A1: The `dev/` artifacts describe the current repo as a single top-level TypeScript app rooted in `src/`, not a greenfield multi-package or Rust workspace.
- A2: The docs accurately describe the current live-session architecture: browser-managed Gemini Live connection, Hono token broker, ephemeral-token auth, audio-first response modality, and `sendRealtimeInput` for runtime text/audio/video.
- A3: The docs accurately describe the current deterministic analysis path in `src/core` and the API endpoints that expose it.
- A4: The docs clearly separate implemented architecture from future product direction documented elsewhere.
- A5: The write set and task framing are reduced to documentation files in `dev/`.

## Allowed Write Set
- `dev/0_SCOPE.md`
- `dev/1_REFERENCE.md`
- `dev/2_ANALYSIS.md`
- `dev/3_SPEC.md`
- `dev/4_PLAN.md`
- `dev/DECISIONS.md`

## Repo Hooks
- Decision: disabled
- Why: Repo-local Codex hooks are unsupported in the current Windows Codex harness, so this task keeps the workflow manual.

## Complexity
Medium

## Context
- Tags: docs-refresh, current-state, gemini-live, hono-api, deterministic-analysis, single-tree-typescript
