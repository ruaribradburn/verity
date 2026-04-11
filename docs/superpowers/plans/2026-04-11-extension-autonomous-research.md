# Plan: Extension autonomous research + live voice (2026-04-11)

## Goals (tracked in `main`)

1. **Autonomous research (Chrome extension)**  
   Parallel tab workflow, SERP parsing, page extraction, orchestrator + `ResearchPanel` UI.  
   **Code:** `packages/extension/src/research/*`, `components/ResearchPanel.tsx`, `background.ts` message wiring.

2. **Live Gemini voice**  
   Ephemeral tokens from `packages/api`, 16 kHz PCM mic → `sendRealtimeInput`, screen JPEGs, Google Search tool at connect time.

3. **Reliable local API from the extension**  
   CORS must allow `chrome-extension://` origins for `http://127.0.0.1:3001`.  
   **Code:** `packages/api/src/index.ts` CORS middleware.

4. **Page text hydration**  
   Active-tab URL hint + trafilatura when possible; screen vision fallback.  
   **Code:** `LiveVoiceSession` `initialPageUrl` / `initialPageTitle`, extension `chrome.tabs.query`, `packages/client/src/screen-share.ts` (wait for video frames).

5. **Mic quality & interruptions**  
   Do not drop mic chunks when the assistant is “speaking” (server handles `START_OF_ACTIVITY_INTERRUPTS`).  
   Echo-limiting: mic graph through zero-gain node; `getUserMedia` with echo cancellation / AGC / noise suppression.  
   **Code:** `packages/client/src/microphone-stream.ts`, shared by web + extension client.

## Runbook

- Repo root: `bun run dev` (web + API).  
- `.env`: `GEMINI_API_KEY`, `API_PORT` / `WEB_ORIGIN` as needed.  
- Extension: `packages/extension` → `bun run build`, load unpacked `dist/`.

## Spec link

See `docs/superpowers/specs/2026-04-11-extension-autonomous-research-design.md` for the design snapshot.
