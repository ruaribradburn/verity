# Verity Agent Guide

This repository is a Bun workspace for a voice-first Gemini Live prototype. The live implementation is package-based under `packages/*`; treat that tree as authoritative over any older root-level `src/` references.

## Start here

- `package.json`: root workspace scripts and shared entrypoints
- `packages/web`: Next.js 16 browser UI
- `packages/client`: shared Gemini Live session manager and React session UI
- `packages/api`: Hono API for tokens, page hydration, validation, and orchestrated analysis
- `packages/core`: shared contracts, Gemini Live defaults, tool declarations, prompt builders, and utilities
- `packages/extension`: Chrome extension side panel, background worker, and autonomous research flow
- `scripts`: repo-level tooling for launching workspaces and local setup
- `docs/architecture.md`: detailed architecture and implementation status
- `dev/geminilive-reference.md`: Live API patterns, including connect-time Google Search grounding

## Runtime shape

Primary browser flow:

1. `packages/web/src/app/page.tsx` renders the browser UI and starts a live session.
2. `packages/client/src/live-session.ts` owns the Gemini Live connection, queue-driven message processing, transcript accumulation, tool-call handling, and multimodal runtime input.
3. `packages/api/src/index.ts` brokers ephemeral tokens at `POST /live/token`, resolves page context at `POST /page/context`, and exposes analysis and validation routes.
4. `packages/core/index.ts` defines the shared types and constants used across browser and server boundaries.

Extension flow:

1. `packages/extension/src/App.tsx` mounts `LiveVoiceSession` from `@packages/client`.
2. Gemini Live can request research tools declared at connect time.
3. `packages/extension/src/background.ts` runs the autonomous research workflow and emits progress events.
4. The extension sends collected `PageContext[]` to `POST /analyze/full` and injects the resulting briefing back into the live session with `sendContext()`.

## Multi-agent pipeline

The server-side analysis pipeline in `packages/api` currently implements the Phase 1 extraction -> analysis -> synthesis path described in the PDR:

- `src/orchestrator.ts`: coordinates agent execution, timeouts, and partial-result fallback for `POST /analyze/full`
- `src/agents/extraction.ts`: Gemini-backed claim and entity extraction
- `src/agents/analysis.ts`: bias detection and credibility scoring
- `src/agents/synthesis.ts`: six-section depolarized briefing generation

Shared pipeline types such as `Claim`, `Entity`, `BiasSignal`, `CredibilityScore`, `AnalysisContext`, `Briefing`, and orchestration request/response envelopes are defined in `packages/core/index.ts`.

## Conventions

- Keep cross-boundary types in `packages/core` first.
- Keep Gemini Live session transport logic in `packages/client/src/live-session.ts`; UI files should orchestrate it rather than reimplementing protocol details.
- Declare Live API tools at `live.connect(...)` time. This includes Google Search grounding and the current research function declarations.
- Use `sendRealtimeInput()` for runtime text, audio, and JPEG frames.
- Use `sendClientContent()` for seeded history or injected context, not live user turns.
- Treat the `AsyncQueue` message loop in `packages/client/src/live-session.ts` as the concurrency boundary for inbound Gemini Live events.
- Prefer package entrypoints over stale root `src/*` references.

## Useful commands

- `bun run dev`: run web and API together from the repo root
- `bun run dev:web`: run only the Next.js app
- `bun run dev:api`: run only the Hono API
- `bun run dev:ext`: build the extension in watch mode
- `bun run check-types`: run all workspace TypeScript checks
- `bun run lint`: run ESLint from the repo root
- `bun run build`: build the web app and extension
- `bun run setup:trafilatura`: install the Python dependency used by `POST /page/context`

## Environment notes

- Root `.env` drives the workspace.
- `GEMINI_API_KEY` is server-only.
- `WEB_PORT` and `API_PORT` must differ.
- `WEB_ORIGIN` controls API CORS allowlists for local web clients.
- `NEXT_PUBLIC_API_ORIGIN` is used by browser clients that call the API directly.
- The extension calls the API with `Origin: chrome-extension://...`; `packages/api` explicitly allows local extension origins for development.
- Page extraction uses `trafilatura` via Python. Set `PYTHON_BIN` if auto-detection is wrong, or run `bun run setup:trafilatura`.

## Known mismatches

- Older docs may still describe a top-level `src/` architecture. The current code lives in `packages/*`.
- Root `ARCHITECTURE.md` is a short current index, while `docs/architecture.md` is the detailed architecture and implementation-status document.
- `dev/AGENTS.md` is an older workflow artifact; use this root `AGENTS.md` for current repo navigation.
