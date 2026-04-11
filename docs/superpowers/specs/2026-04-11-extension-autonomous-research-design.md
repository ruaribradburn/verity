# Design snapshot: Extension research + live voice (2026-04-11)

## Architecture

- **Side panel UI:** `LiveVoiceSession` (`@packages/client`) + optional `ResearchPanel` for batch SERP/open-tab research driven from `background.ts`.
- **API (`packages/api`):** `POST /live/token`, `POST /page/context`, CORS including `chrome-extension://` for local dev.
- **Shared core:** Types and live defaults in `packages/core`; Gemini Live session loop in `packages/client/src/live-session.ts`.

## Audio pipeline

- **Input:** Browser mic → resample to **16 kHz** PCM16 → base64 → `sendRealtimeInput({ audio })` with `audio/pcm;rate=16000`.
- **Output:** Assistant PCM → `onAudioChunk` → Web Audio playback at **24 kHz** (dedicated `AudioContext`, separate from capture graph).
- **Interruptions:** Rely on Live **activity handling** and continuous mic streaming; do not gate capture on UI “speaking” state.

## Extension-specific

- **Tab hints:** `chrome.tabs.query({ active: true, lastFocusedWindow: true })` supplies HTTP(S) URL/title for `/page/context` when the user has not typed overrides.
- **Permissions:** `host_permissions` for localhost API + `<all_urls>` for research/navigation patterns as in `public/manifest.json`.

## Research module (orchestrator)

- Message types in `research/types.ts`; orchestrator opens/manages tabs with timeouts; injects `extractor` / `serp-parser` where applicable.

This document is a stable reference for what we intended to ship alongside the implementation on `main`.
