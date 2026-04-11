# Verity — Architecture

## Repository layout

| Path | Role |
| --- | --- |
| `packages/core` | Shared types, constants, analysis helpers, multi-agent schema |
| `packages/api` | Hono HTTP API: token brokering, page hydration, agent endpoints, orchestrator |
| `packages/client` | Browser-side Gemini Live session manager, screen/mic capture, shared React UI |
| `packages/web` | Next.js App Router standalone demo UI |
| `packages/extension` | Chrome extension: side panel, background worker, autonomous research module |
| `scripts` | Dev tooling: workspace runner, port management, trafilatura installer |

Run `bun run dev` from the repo root to start the web app and API together. Ports, CORS, and credentials are defined in the repo-root `.env`.

## Multi-Agent Pipeline (PDR Phase 1)

The server-side analysis pipeline lives in `packages/api` and follows the PDR §6.2 data flow:

1. **Ingestion**: Client sends `PageContext[]` (single page or multi-tab batch) to `POST /analyze/full`.
2. **Extraction agent** (`packages/api/src/agents/extraction.ts`): Uses Gemini to extract claims and entities from page content. Returns `Claim[]` + `Entity[]`.
3. **Analysis agent** (`packages/api/src/agents/analysis.ts`): Takes claims + entities, detects bias signals and computes credibility scores. Returns `BiasSignal[]` + `CredibilityScore[]`.
4. **Synthesis agent** (`packages/api/src/agents/synthesis.ts`): Merges all agent outputs into a 6-section `Briefing` (PDR §5.3) with depolarized, evidence-weighted tone (PDR §1.5).
5. **Delivery**: The briefing is returned to the caller. In the extension, it's injected into the Gemini Live voice session via `sendContext()`.

The orchestrator (`packages/api/src/orchestrator.ts`) coordinates the pipeline: sequential agent execution with per-agent timeouts, partial-result fallback, and session tracking.

### Shared Schema

All agents read/write a common `AnalysisContext` defined in `packages/core/index.ts`:

- `pages: PageContext[]` — ingested content
- `claims: Claim[]` — extracted assertions
- `entities: Entity[]` — NER results
- `biasSignals: BiasSignal[]` — detected bias indicators
- `credibilityScores: CredibilityScore[]` — per-source scores
- `evidenceBundles: EvidenceBundle[]` — claim-evidence links

### API Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Service liveness |
| GET | `/live/config` | Gemini Live session config |
| POST | `/live/token` | Mint ephemeral Gemini token |
| POST | `/page/context` | Hydrate page text (trafilatura + vision) |
| POST | `/analyze/full` | Full orchestrated pipeline → Briefing |
| POST | `/analyze/extract` | Extraction agent only |
| POST | `/analyze/bias` | Analysis agent only |
| POST | `/analyze/synthesize` | Synthesis agent only |
| POST | `/analyze` | Legacy deterministic analysis |

## Voice Architecture

The Gemini Live voice session (`packages/client/src/live-session.ts`) connects to `gemini-3.1-flash-live-preview` with:
- Audio response modality
- Google Search grounding (built-in tool)
- 16 kHz PCM mic input, 24 kHz playback
- Screen share at 1 FPS JPEG
- Context injection via `sendContext()` / `sendClientContent()`

## Extension Research

The Chrome extension (`packages/extension/src/research/`) runs autonomous client-side research:
- Derives search queries from page content
- Opens background tabs, extracts Google SERP results
- Reads up to 15 pages in parallel (5 concurrent)
- On completion, sends collected pages to `POST /analyze/full` for server-side analysis
- Injects the structured briefing into the live voice session

## Product Design Reference

See [docs/PDR.md](./PDR.md) for the full product design and requirements document.
