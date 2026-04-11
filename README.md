# Verity

Verity is a Bun workspaces monorepo for the Phase 1 "Voice Analyst" slice. The current implementation is a deterministic local core loop that takes page text, applies framing and omission analysis, and returns an uncertainty-calibrated response shape that can later sit behind a Gemini Live session.

## Packages

- `packages/core`: shared domain models, fixtures, and the local analysis engine
- `packages/api`: Hono API exposing `/health`, `/fixtures`, `/validate`, `/analyze`, `/live/config`, and `/live/token`
- `packages/web`: Next.js operator UI for pasting page context and inspecting the resulting analysis

## Run locally

1. Copy `.env.example` to `.env`.
2. Install dependencies with `bun install`.
3. Start the web app and API with `bun run dev`.

Default URLs:

- Web UI: `http://localhost:3000`
- API: `http://127.0.0.1:3001`
- Health: `http://127.0.0.1:3001/health`

Run individual services if needed:

```bash
bun run dev:web
bun run dev:api
```

## Phase 1 flow

1. Paste or load a fixture page payload in the web UI.
2. Submit a prompt such as `What am I missing here?`
3. The web app posts an `AnalysisRequest` to `packages/api`.
4. The API normalizes the payload and calls the shared analysis engine in `packages/core`.
5. The UI renders a structured `AnalysisResponse` with:
   - grounded summary
   - bias signals
   - missing context
   - confidence notes
   - follow-up prompts

This is intentionally narrower than the long-term roadmap. Persistent memory, dashboard views, live audio IO, and background fan-out are still deferred.

## Gemini Live patterns

The repo is now shaped around the recommended Live API patterns for `gemini-3.1-flash-live-preview`:

- browser clients should authenticate with ephemeral tokens from `POST /live/token`
- runtime user input should go through `sendRealtimeInput`
- `sendClientContent` should only be used to seed initial history before live interaction starts
- live sessions should keep session resumption and context-window compression enabled
- audio is the primary response modality; do not mix text and audio modalities in the same session
- tool declarations belong in the initial `live.connect()` config, not mid-session

The current browser session scaffold lives in `packages/web/lib/live-session.ts`.

## Validation

Run the workspace type checks:

```bash
bun run check-types
```

Run the web lint pass:

```bash
bun run lint
```

The API also exposes local fixture checks at `GET /validate`. The current fixtures cover:

- current-page grounding
- false-balance guardrails

## Environment

- `WEB_PORT`: Next.js dev server port
- `API_PORT`: API server port
- `WEB_ORIGIN`: comma-separated origins allowed by API CORS
- `API_ORIGIN`: server-side API base URL for Next
- `NEXT_PUBLIC_API_ORIGIN`: browser-visible API base URL for client-side fetches
- `GEMINI_API_KEY`: server-side key used to mint ephemeral tokens

## Next implementation steps

- replace the deterministic local analysis engine with a queue-driven Gemini Live session manager
- move page capture into a browser extension or side-panel surface
- add explicit session state, transcript handling, and tool-calling boundaries
- keep long-running research and memory work outside the runtime-critical live loop
