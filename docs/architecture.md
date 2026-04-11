# Real-Time Multimodal Intelligence Agent — End-to-End Architecture

This diagram reflects the system described in [`PDR.md`](./PDR.md): entry points → ingestion → **multilingual canonicalization** → orchestrator → specialized agents → shared structured context → **Gemini-backed** synthesis → user-facing output (text **and** voice from the **same** briefing). Synthesis defaults to a **depolarized, evidence-aware briefing** (PDR §1.5), not a single authoritative “correct” answer.

**API stack**: prompts and keys are managed in [Google AI Studio](https://aistudio.google.com/prompts/new_chat); production uses the **Gemini API** aligned with that configuration (PDR §1.6).

```mermaid
flowchart TB
  subgraph Client["User & entry points"]
    EXT[Browser extension]
    CHAT[Chat interface]
    API[API integration]
  end

  subgraph Ingestion["Ingestion layer"]
    ING[Normalize content · provenance<br/>web · PDF · video transcript · audio]
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
    RES_POOL[Research / verification agents<br/>parallel claim bundles]
    SYN[Synthesis / output agent<br/>depolarized briefing · uncertainty · citations]
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
    RAG[RAG / retrieval]
  end

  subgraph Output["User-visible output"]
    UI[Structured UI · locale at render time]
    VOICE[Spoken delivery · user locale]
  end

  EXT --> ING
  CHAT --> ING
  API --> ING

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

  GRAPH_AG <--> KG
  UI <--> DASH

  STUDIO -.->|versioned config| GAPI
  SYN & RES_POOL & CRED_AG & VA -.-> GAPI
  EXT_AG -.-> NER_M
  BIAS_AG -.-> SENT
  RES_POOL -.-> RAG

  SYN -->|one merged briefing object| UI
  SYN -->|same object| VA
  VA --> VOICE
  GAPI -.-> VA

  ORC -.->|low confidence · conflicts · high-impact claims| RES_POOL
```

> **Note:** Mermaid node text is plain; the Studio URL is also documented in this file’s intro and in PDR §1.6. In diagrams that do not support HTML links, refer to **Google AI Studio → Prompts (new chat)**.

## Legend

- **Solid arrows**: primary data and orchestration paths (ingest → **canonicalize** → fan-out → merge → synthesis).
- **Dotted arrows**: model/API usage (Gemini API, auxiliary models) and orchestrator **escalation** to research agents.
- **Shared structured context**: one **language-agnostic** representation after `LANG` so cross-language evidence merges before synthesis (PDR §1.6).
- **Gemini stack**: Studio is for **development and configuration**; **GAPI** is **runtime**. **Voice agent** uses the **same** merged briefing as the UI; locale is applied at **render / speak** time.
- **Epistemic stance**: merged output is framed as **analysis with limits**, not infallible truth (PDR §1.5).
