# Real-Time Multimodal Intelligence Agent - End-to-End Architecture

## Repository layout

| Path | Role |
| --- | --- |
| `src/core` | Shared types, constants, runtime config, and analysis helpers |
| `src/app` | Next.js App Router UI |
| `src/lib` | Browser-side Gemini Live session runtime |
| `src/server` | Standalone HTTP API (Hono) |
| `scripts` | Dev tooling and launch helpers |

Run `bun run dev` from the repo root to start the web app and API together. Ports, CORS (`WEB_ORIGIN`), and the API URL (`API_ORIGIN`) are defined in the repo-root `.env`.

The broader product architecture described in [PDR.md](./PDR.md) still applies, but the implementation now lives in one top-level `src/` tree instead of `packages/*`.
