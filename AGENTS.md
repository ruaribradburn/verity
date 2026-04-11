# Verity Agent Guide

This repository is a Bun workspace for a voice-first Gemini Live prototype. The real implementation currently lives in `packages/*`, not in the top-level `src/` layout described by some older docs. Treat the package tree as authoritative when navigating or editing the codebase.

## Start Here

- `package.json`: root workspace scripts and shared dev entrypoints
- `packages/web`: Next.js 16 app router shell for the main browser UI
- `packages/client`: reusable browser-side live session manager and shared React session UI
- `packages/api`: Hono API for ephemeral Gemini token minting, page hydration, and deterministic validation endpoints
- `packages/core`: shared contracts, Gemini Live defaults, page-analysis helpers, and utility primitives
- `packages/extension`: Vite-powered browser extension shell that embeds the shared client UI
- `scripts`: repo-level tooling for launching workspaces and clearing dev ports
- `dev/geminilive-reference.md`: implementation reference for Live API patterns, including connect-time Google Search grounding

## Runtime Shape

The main user flow is:

1. `packages/web/src/app/page.tsx` renders the browser UI and starts a live session.
2. `packages/client/src/live-session.ts` owns the Gemini Live connection, queue-driven message processing, transcript accumulation, and multimodal runtime input.
3. `packages/api/src/index.ts` brokers ephemeral tokens at `POST /live/token`, resolves page context at `POST /page/context`, and exposes local validation endpoints.
4. `packages/core/index.ts` defines the types and constants shared across browser and server boundaries.

The extension path is deliberately thin:

- `packages/extension/src/App.tsx` mounts `LiveVoiceSession` from `@packages/client`
- `packages/extension/src/background.ts` only configures side-panel behavior

## Multi-Agent Pipeline

The server-side analysis pipeline at `packages/api` implements PDR §6.2:

- **Orchestrator** (`src/orchestrator.ts`): Coordinates extraction → analysis → synthesis with timeouts and partial-result fallback. Entry point: `POST /analyze/full`.
- **Extraction agent** (`src/agents/extraction.ts`): Gemini-backed NER and claim extraction from page content.
- **Analysis agent** (`src/agents/analysis.ts`): Bias detection and credibility scoring using extracted claims and entities.
- **Synthesis agent** (`src/agents/synthesis.ts`): Produces a 6-section depolarized briefing (PDR §5.3) from the full analysis context.

Shared types for the pipeline (`Claim`, `Entity`, `BiasSignal`, `CredibilityScore`, `AnalysisContext`, `Briefing`, `OrchestrationRequest/Response`) are defined in `packages/core/index.ts`.

The extension wires voice turns → client-side research → `POST /analyze/full` → briefing injection into the Gemini Live session via `sendContext()`.

## Conventions

- Keep cross-boundary types in `packages/core` first. If a payload is shared between browser and server, define it there instead of duplicating shapes.
- Keep Gemini Live session logic in `packages/client/src/live-session.ts`. UI files should orchestrate it, not reimplement transport behavior.
- Declare Live API tools at `live.connect(...)` time. This now includes Google Search grounding, following `dev/geminilive-reference.md`.
- Use `sendRealtimeInput()` for runtime text, audio, and JPEG frames. Use `sendClientContent()` only for seeded history/page context.
- Treat the `AsyncQueue` message loop as the concurrency boundary for inbound Gemini Live events.
- Prefer the package-specific entrypoints over stale top-level doc references to `src/app`, `src/lib`, or `src/server`.

## Useful Commands

- `bun run dev`: run web and API together from the repo root (required for live voice: the extension and web UI call `packages/api` on `API_PORT`, default `3001`)
- `bun run dev:web`: run only the Next.js app in `packages/web`
- `bun run dev:api`: run only the Hono API in `packages/api`
- `bun run check-types`: run all workspace TypeScript checks
- `bun run setup:trafilatura`: install the Python `trafilatura` package (required for `/page/context` article text). Needs `python3` on PATH; on macOS without it: `brew install python`, then run this again
- `bun run lint`: run ESLint from the repo root
- `bun run build`: build the web app

## Environment Notes

- Root `.env` drives both workspaces.
- `GEMINI_API_KEY` is server-only and is used to mint ephemeral browser tokens.
- `WEB_PORT` and `API_PORT` must differ.
- `NEXT_PUBLIC_API_ORIGIN` is used by the browser client when it needs to call the API directly.
- The Chrome extension uses `Origin: chrome-extension://…`; `packages/api` allows those origins for local development so `fetch` to `http://127.0.0.1:3001` succeeds.
- Page extraction tries `python3` then `python` on macOS/Linux, and `python` then `python3` on Windows, unless `PYTHON_BIN` is set. Install the Python dependency with **`bun run setup:trafilatura`** (uses `scripts/requirements.txt`) or manually: `python3 -m pip install -r scripts/requirements.txt`. **Brew** installs Python (`brew install python`), not the pip package; **bun** runs our installer script but does not replace pip for trafilatura.

## Product plans (superpowers)

- `docs/superpowers/plans/2026-04-11-extension-autonomous-research.md` — implementation checklist (research UI + live voice + API/extension wiring).
- `docs/superpowers/specs/2026-04-11-extension-autonomous-research-design.md` — design snapshot for the same effort.

## Known Mismatches

- `README.md` and `ARCHITECTURE.md` still describe a planned top-level `src/` layout. The actual code is package-based.
- There is an older workflow artifact at `dev/AGENTS.md`; use this root `AGENTS.md` as the lightweight navigation index for the live repository state.
