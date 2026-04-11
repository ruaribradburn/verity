# Verity

Verity is a Bun workspace for a voice-first Gemini Live browsing prototype with a web demo, a Chrome extension, shared browser-side session code, and a Hono API for token brokering, page hydration, and analysis.

## Repo layout

- `packages/web`: Next.js 16 App Router demo for the live browser UI
- `packages/client`: shared Gemini Live session manager and reusable React session UI
- `packages/api`: Hono API for ephemeral Gemini tokens, page hydration, deterministic validation, and orchestrated analysis
- `packages/core`: shared types, Gemini Live defaults, prompt builders, and analysis helpers
- `packages/extension`: Vite-powered Chrome extension with side-panel UI and autonomous research flow
- `scripts`: workspace runner, port cleanup, and local setup helpers
- `docs/architecture.md`: current package-based architecture and implementation status
- `docs/PDR.md`: product design and requirements document

## Current product shape

- The web app starts a Gemini Live voice session, streams microphone audio and screen-share frames, and can hydrate page context through `POST /page/context`.
- The extension mounts the shared live UI, handles Gemini tool calls for research, runs client-side autonomous browsing research, and sends collected sources to `POST /analyze/full`.
- The API exposes:
  - `GET /health`
  - `GET /live/config`
  - `POST /live/token`
  - `POST /page/context`
  - `GET /validate`
  - `POST /analyze`
  - `POST /analyze/extract`
  - `POST /analyze/bias`
  - `POST /analyze/synthesize`
  - `POST /analyze/full`
- The server-side multi-agent pipeline currently runs extraction -> analysis -> synthesis through `packages/api/src/orchestrator.ts`.

## Run locally

1. Copy `.env.example` to `.env`.
2. Install dependencies with `bun install`.
3. Start the web app and API with `bun run dev`.

Useful scripts:

- `bun run dev:web`
- `bun run dev:api`
- `bun run dev:ext`
- `bun run check-types`
- `bun run lint`
- `bun run build`
- `bun run setup:trafilatura`

Default local URLs:

- Web UI: `http://localhost:3000`
- API: `http://127.0.0.1:3001`
- Health: `http://127.0.0.1:3001/health`

## Environment

- Root `.env` is shared across the workspace.
- `GEMINI_API_KEY` is server-only and is required for ephemeral Gemini Live token minting and Gemini-backed analysis.
- `WEB_PORT` and `API_PORT` must differ.
- `WEB_ORIGIN` configures API CORS allowlists for local web clients.
- `NEXT_PUBLIC_API_ORIGIN` is the browser-visible API base URL.
- `PYTHON_BIN` can override the Python executable used for `trafilatura` page extraction.

## Notes

- The real implementation lives in `packages/*`. Older references to a top-level `src/` tree are stale.
- `ARCHITECTURE.md` is now a short root-level index; use `docs/architecture.md` for the detailed architecture and implementation-status matrix.
