# Real-Time Multimodal Intelligence Agent — End-to-End Architecture

## Repository layout

| Package | Role |
| --- | --- |
| `packages/core` | Shared types, constants, and domain logic (single source of truth for cross-package contracts). |
| `packages/web` | Next.js App Router UI and any BFF/route handlers you add there. |
| `packages/api` | Standalone HTTP API (Hono); extends `core` for health and future REST/WS surfaces. |

Run **`bun run dev`** from the repo root to start `packages/web` and `packages/api` together. Ports, CORS (`WEB_ORIGIN`), and server-side API URL (`API_ORIGIN`) are defined in the **repo-root `.env`** (see `.env.example`).

---

This diagram reflects the system described in [`PDR.md`](./PDR.md): **multi-tab client capture** → ingestion → **multilingual canonicalization** → orchestrator → specialized agents → **backend research + source connectors** → shared structured context → **Gemini-backed** synthesis → user-facing output (text **and** voice from the **same** briefing). Synthesis defaults to a **depolarized, evidence-aware briefing** (PDR §1.5), not a single authoritative “correct” answer.

**API stack**: prompts and keys are managed in [Google AI Studio](https://aistudio.google.com/prompts/new_chat); production uses the **Gemini API** aligned with that configuration (PDR §1.6).

**Multi-tab & backend research** (PDR §1.7, §4.1, §4.11): the extension batches **several tabs** in one session; **research agents** on the backend add **news / video / social / web** evidence via **policy-compliant connectors**—detailed verification is **server-side**, not split across ad-hoc client-only models.

```mermaid
flowchart TB
  subgraph Client["Client · extension & UI"]
    EXT[Browser extension]
    MT[Multi-tab session coordinator<br/>consent · capture N tabs · batch upload]
    FE_G[Optional client Gemini<br/>tab relevance hints only · not authoritative research]
    CHAT[Chat interface]
    API[API integration]
  end

  subgraph Ingestion["Ingestion layer"]
    ING[Normalize payloads · provenance per tab/surface<br/>web · PDF · video transcript · audio]
  end

  subgraph I18n["Multilingual canonicalization"]
    LANG[Language detect · align spans<br/>→ one language-agnostic structured state]
  end

  subgraph Orch["Multi-agent orchestrator"]
    ORC[Supervisor: routing · parallelism · merge · timeouts · escalation]
  end

  subgraph Shared["Shared structured context"]
    MEM[(Working memory · canonical:<br/>claims · entity IDs · scores · evidence IDs · open questions)]
  end

  subgraph Agents["Specialized agents"]
    direction TB
    EXT_AG[Extraction / NER agent<br/>entities · spans · disambiguation]
    GRAPH_AG[Graph agent<br/>nodes · edges · confidence]
    BIAS_AG[Bias / framing agents]
    CRED_AG[Credibility agent]
    RES_POOL[Backend research / verification agents<br/>parallel claim bundles · primary deep research]
    SYN[Synthesis / output agent<br/>depolarized briefing · uncertainty · citations]
  end

  subgraph Connectors["Backend source connectors · policy-compliant"]
    NEWS[News · wires · RSS/API]
    VID[Video · e.g. YouTube captions/metadata]
    SOC[Social · official APIs / permitted public data]
    WEB[Targeted web retrieval · RAG cache]
  end

  subgraph GeminiStack["Google AI Studio · Gemini API"]
    STUDIO[AI Studio: prompts · models · keys · eval]
    GAPI[Gemini API · runtime generation]
    VA[Voice agent · speech I/O<br/>same briefing as text · Studio-aligned]
  end

  subgraph Stores["Persistence & intelligence"]
    KG[(Knowledge graph store)]
    DASH[(Dashboard memory<br/>entities · topics · bias patterns · interests)]
  end

  subgraph AuxModels["Auxiliary models"]
    NER_M[NER / classifiers as needed]
    SENT[Sentiment / framing classifiers]
    RAG[RAG / retrieval index]
  end

  subgraph Output["User-visible output"]
    UI[Structured UI · locale at render time · per-surface status optional]
    VOICE[Spoken delivery · user locale]
  end

  EXT --> MT
  MT --> ING
  CHAT --> ING
  API --> ING
  MT -.-> FE_G
  FE_G -.-> GAPI

  ING --> LANG
  LANG --> ORC

  ORC <-->|read/write| MEM
  ORC --> EXT_AG
  ORC --> GRAPH_AG
  ORC --> BIAS_AG
  ORC --> CRED_AG
  ORC --> RES_POOL
  ORC --> SYN

  EXT_AG <-->|entities · spans| MEM
  GRAPH_AG <-->|graph deltas| MEM
  BIAS_AG & CRED_AG -->|structured scores · rationale| MEM
  RES_POOL -->|evidence bundles · citable findings| MEM

  RES_POOL <--> NEWS
  RES_POOL <--> VID
  RES_POOL <--> SOC
  RES_POOL <--> WEB
  RES_POOL -.-> RAG

  GRAPH_AG <--> KG
  UI <--> DASH

  STUDIO -.->|versioned config| GAPI
  SYN & RES_POOL & CRED_AG & VA -.-> GAPI
  EXT_AG -.-> NER_M
  BIAS_AG -.-> SENT

  SYN -->|one merged briefing object| UI
  SYN -->|same object| VA
  VA --> VOICE
  GAPI -.-> VA

  ORC -.->|low confidence · conflicts · broadened research pass| RES_POOL
```

> **Note:** Mermaid node text is plain; the Studio URL is documented in this file’s intro and in PDR §1.6.

## Legend

- **Solid arrows**: primary data and orchestration paths (multi-tab **batch** ingest → **canonicalize** → fan-out → **backend research** → merge → synthesis).
- **Dotted arrows**: model/API usage (Gemini API, optional **client hints** only), auxiliary models, and orchestrator **escalation** to research agents.
- **Multi-tab (`MT`)**: several tabs → **one** batched ingest; all surfaces merge in **MEM** before synthesis (PDR §1.7).
- **Connectors**: **server-side** only; broaden evidence (news, video, social, web) under **ToS/API** rules—**not** a substitute for user judgment (PDR §4.11).
- **Client Gemini (`FE_G`)**: optional **UX hints** (e.g. tab relevance); **authoritative** research stays in **RES_POOL** + connectors.
- **Shared structured context**: one **language-agnostic** representation after `LANG` (PDR §1.6).
- **Gemini stack**: Studio = **development and configuration**; **GAPI** = **runtime**. **Voice agent** uses the **same** merged briefing as the UI.
- **Epistemic stance**: merged output is **analysis with limits**, not infallible truth (PDR §1.5).
