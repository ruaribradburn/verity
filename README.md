# Verity

Verity now uses a single top-level `src/` tree instead of the old `packages/*` layout.

## Source layout

- `src/app`: Next.js UI
- `src/lib`: browser-side Gemini Live session code
- `src/server`: Hono API server
- `src/core`: shared types, runtime config, and deterministic analysis helpers
- `scripts`: dev tooling and launch helpers

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

## Current app shape

The current UI is transcript-first and aimed at the real product interaction:

- start a Gemini Live voice session
- share the current screen/tab
- let Verity reason about what it is seeing
- optionally send typed messages into the same live session

## Gemini Live patterns

The repo is shaped around the recommended Live API patterns for `gemini-3.1-flash-live-preview`:

- browser clients authenticate with ephemeral tokens from `POST /live/token`
- runtime user input goes through `sendRealtimeInput`
- `sendClientContent` is reserved for initial history seeding
- live sessions keep context-window compression enabled
- audio is the primary response modality
- tool declarations belong in the initial `live.connect()` config

The current browser session scaffold lives in `src/lib/live-session.ts`.

## Validation

```bash
bun run check-types
bun run lint
bun run build
```

The API also exposes local checks at `GET /validate`.

## Environment

- `WEB_PORT`: Next.js dev server port
- `API_PORT`: API server port
- `WEB_ORIGIN`: comma-separated origins allowed by API CORS
- `API_ORIGIN`: server-side API base URL for Next
- `NEXT_PUBLIC_API_ORIGIN`: browser-visible API base URL
- `GEMINI_API_KEY`: server-side key used to mint ephemeral tokens
