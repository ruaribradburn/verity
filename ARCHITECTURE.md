# Verity Architecture

This repository is a Bun workspace. The live implementation is package-based under `packages/*`, not the older top-level `src/` layout referenced by some historical docs.

## Current architecture

- `packages/web`: Next.js 16 demo UI for browser-based Gemini Live sessions
- `packages/client`: shared live session manager, transcript/runtime handling, and reusable React UI
- `packages/api`: Hono API for ephemeral token brokering, page hydration, deterministic validation, and orchestrated analysis
- `packages/core`: shared contracts, Gemini Live defaults, prompt/system-instruction builders, and analysis utilities
- `packages/extension`: Chrome extension side panel, background worker, and autonomous research flow

## Runtime flow

1. `packages/web/src/app/page.tsx` or `packages/extension/src/App.tsx` starts a live session through `@packages/client`.
2. `packages/client/src/live-session.ts` connects to Gemini Live with an ephemeral token from `POST /live/token`, streams text/audio/video via `sendRealtimeInput()`, and injects seeded context via `sendClientContent()`.
3. `packages/api/src/index.ts` exposes token minting, `POST /page/context`, validation routes, and the analysis endpoints.
4. `packages/api/src/orchestrator.ts` coordinates extraction -> analysis -> synthesis for `POST /analyze/full`.
5. `packages/core/index.ts` defines the shared schema used across browser, extension, and server boundaries.

## Current implementation status

High-level status as of the current repo:

- Implemented: web demo, extension shell, shared live session manager, ephemeral Gemini token brokerage, page hydration, deterministic analysis path, and the extraction/analysis/synthesis orchestration pipeline.
- Partially implemented: multilingual/canonicalization ambitions from the PDR, evidence bundle population, explicit multi-tab product semantics, and low-latency streaming orchestration.
- Not yet implemented: the broader Phase 2+ graph, backend connector, and dashboard roadmap items from the PDR.

## Canonical references

- Detailed architecture and status: [docs/architecture.md](/C:/Users/ruari/Storage/Code/verity/docs/architecture.md)
- Product requirements: [docs/PDR.md](/C:/Users/ruari/Storage/Code/verity/docs/PDR.md)
- Repo navigation for agents: [AGENTS.md](/C:/Users/ruari/Storage/Code/verity/AGENTS.md)

Treat this file as the root-level architecture index. For detailed done-vs-remaining status, `docs/architecture.md` is authoritative.
