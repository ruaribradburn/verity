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

---

## Implementation status

*(Done vs remaining vs the PDR.)*

This section tracks the **current codebase** against [PDR.md](./PDR.md). The executable system lives under `packages/*` (not the legacy `src/` tree described in some older docs).

### Done (shipped in repo today)

| Area | What exists |
| --- | --- |
| **Phase 1 skeleton (PDR §12)** | Browser extension (`packages/extension`), web demo (`packages/web`), shared client UI (`packages/client`). |
| **Orchestrator + shared schema (PDR §4.6, §6.2)** | `packages/api/src/orchestrator.ts` runs extraction → analysis → synthesis. `AnalysisContext`, `Briefing`, claims/entities/bias/credibility types in `packages/core/index.ts`. |
| **Agents** | Extraction (`agents/extraction.ts`), analysis (`agents/analysis.ts`), synthesis (`agents/synthesis.ts`) producing the six PDR §5.3 sections with depolarized, uncertainty-aware prompts (PDR §1.5). |
| **Multi-page input** | `POST /analyze/full` accepts `pages: PageContext[]` plus optional `researchContexts`. Batches multiple URLs/texts in one orchestration run. |
| **Page hydration** | `POST /page/context` (trafilatura for article text; Gemini vision for URL resolution from screen when no URL hint is provided). |
| **Gemini Live voice (PDR §1.6, §4.10)** | Ephemeral tokens, mic/screen, Google Search at connect, briefing injected via `sendContext()` so voice aligns with the same structured briefing as text. |
| **Extension “autonomous research”** | Client-side query/SERP workflow, parallel page reads, then `POST /analyze/full` — not server-side connectors. See `packages/extension/src/research/`. |
| **API surface** | Health, live config/token, analyze endpoints as listed above; CORS for local extension origins. |
| **Legacy deterministic path** | `POST /analyze` + fixtures for guardrails (`packages/core` + API). |

### Partially done (schema or UX exists; behavior incomplete vs PDR)

| Area | Gap |
| --- | --- |
| **`evidenceBundles` (PDR §4.7, §6.2)** | Typed on `AnalysisContext` and passed into synthesis prompts, but **nothing populates** them in the orchestrator today — always empty. |
| **Multilingual path (PDR §1.6, §8.1)** | **Single canonical structured state** exists for analysis, but orchestration does not run language detection or cross-language canonicalization; delivery locale is not a full product layer yet. |
| **Multi-tab sessions (PDR §1.7)** | API can ingest multiple pages; extension gathers related pages via research. **Explicit tab-session coordinator, consent UX, and “include these tabs”** as a first-class product model are not fully implemented vs the PDR narrative. |
| **Latency (PDR §9)** | Per-agent timeouts are large (~30s); end-to-end pipeline is **not** tuned for sub–2s first response. Streaming/partial briefing is not a first-class orchestrator feature yet. |
| **Observable pipeline (PDR §8.2)** | Briefing metadata includes agent contribution summaries; **no** full audit UI or per-agent drill-down. |

### Not started or out of scope for current code (PDR Phase 2+ or “should have”)

| Area | PDR reference |
| --- | --- |
| **Knowledge graph engine** (dynamic graph, edge types, confidence on edges) | §4.3, §6.1 item 5 |
| **Backend source connectors** (news, YouTube, social, web fetch as **server-side** policy-compliant modules feeding research agents) | §4.11, §6.1 item 9 |
| **Dedicated research / verification agents** (parallel pool, escalation, RAG + connectors writing **evidence bundles**) | §4.7, §6.2 steps 6–7 |
| **Orchestrator parallelism** where safe (today: **sequential** extraction → analysis → synthesis) | §4.6, §9 |
| **Intelligence dashboard / persistence** (entities, topics, bias patterns, user interests) | §4.9, roadmap Phase 3 |
| **Rich ingest** (PDFs, video transcripts, audio streams as first-class ingest types) | §4.1 |
| **Passive auto-analysis while browsing** | §5.2 |
| **Knowledge graph visualization** | §8.2 |
| **Personalization / real-time alerts** | §8.3, roadmap |

### How to read this vs PDR roadmap

- **PDR Phase 1** (extension, basic analysis, orchestrator + multi-agent skeleton): **largely implemented**, with gaps on multilingual canonicalization, populated evidence bundles, and strict multi-tab product semantics.
- **PDR Phase 2** (graph, parallel research, escalation): **not implemented** as specified; extension-side research is a stand-in for broader evidence, not backend connectors + verification agents.
- **PDR Phase 3** (dashboard, personalization): **not implemented**.

For extension + voice wiring details, see [superpowers/plans/2026-04-11-extension-autonomous-research.md](./superpowers/plans/2026-04-11-extension-autonomous-research.md).
