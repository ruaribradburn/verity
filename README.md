# Verity

Verity is a realtime research agent for navigating information online. It listens to what the user is trying to understand, reads the page they are on, performs additional research in the background, and grounds its responses against more reliable external sources instead of relying on a single page, feed, or model completion.

The product is built around a live voice session. While the user is browsing, Verity can inspect the current page, fan out into related sources, compare claims across multiple references, and return a structured briefing designed to reduce confusion, bias, and low-trust framing. The goal is not just to summarize a page, but to help the user answer: what is being claimed, what evidence supports it, what looks weak or loaded, and what higher-confidence sources say instead.

## What the project does

Verity combines a live multimodal assistant with an orchestrated research pipeline:

- A web app and Chrome extension start a Gemini Live session with voice, page context, and optional screen-share input.
- The browser-side client can hydrate the current page into structured text and metadata.
- The extension can run autonomous research flows, collecting related pages and source material beyond the tab the user is viewing.
- The API runs a multi-agent analysis pipeline that extracts claims and entities, performs additional grounded research, checks for bias and credibility signals, links evidence back to claims, and synthesizes a depolarized briefing.
- The resulting briefing is injected back into the live session so the assistant can respond in realtime with the same grounded context.

In practice, this means Verity acts more like a research copilot than a chatbot: it keeps gathering evidence while the conversation is happening.

## Core product behavior

- Realtime voice interaction through Gemini Live
- Additional research beyond the current page, including extension-driven browsing and Gemini-grounded search
- Claim extraction, entity extraction, bias analysis, credibility scoring, and evidence linking
- Structured briefings that summarize what matters without mirroring the rhetoric of the source material
- Shared contracts and prompt logic across the browser, extension, and server pipeline

## Architecture

The active codebase is package-based under `packages/*`.

- `packages/web`: Next.js 16 web app for the browser UI and live session demo
- `packages/client`: shared Gemini Live session manager and reusable React session UI
- `packages/api`: Hono API for token brokering, page hydration, validation, and orchestrated analysis
- `packages/core`: shared contracts, Gemini Live defaults, tool declarations, prompt builders, and utilities
- `packages/extension`: Chrome extension side panel, background worker, and autonomous research flow
- `scripts`: workspace runner, port cleanup, and local setup helpers

Useful reference docs:

- `docs/architecture.md`: detailed package architecture and implementation status
- `docs/PDR.md`: product design and requirements
- `dev/geminilive-reference.md`: Live API patterns, including connect-time Google Search grounding

## Current analysis pipeline

The main server-side path lives in `packages/api` and currently works like this:

1. A client sends one or more `PageContext` objects to `POST /analyze/full`.
2. Verity extracts claims and entities from the collected material.
3. The orchestrator fans out into research, bias, credibility, and graph-oriented analysis.
4. A fact-check stage links evidence back to the extracted claims.
5. A synthesis stage generates a six-section briefing in a deliberately neutral, depolarized tone.
6. That briefing is returned to the caller and can be injected back into the live voice session.

This is the key distinction of the project: analysis is not limited to the page the user started from. Verity is designed to keep researching in parallel and ground its answers against a broader, more reliable source set.

## API surface

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

- The authoritative implementation lives in `packages/*`; older references to a top-level `src/` tree are stale.
- `ARCHITECTURE.md` is a short root-level index. Use `docs/architecture.md` for the detailed architecture and status view.
