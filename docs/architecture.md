# Real-Time Multimodal Intelligence Agent — End-to-End Architecture

This diagram reflects the system described in [`PDR.md`](./PDR.md): entry points → ingestion → orchestrator → specialized agents → shared structured context → synthesis → user-facing output, with persistence and model dependencies. Synthesis defaults to a **depolarized, evidence-aware briefing** (see PDR §1.5), not a single authoritative “correct” answer.

```mermaid
flowchart TB
  subgraph Client["User & entry points"]
    EXT[Browser extension]
    CHAT[Chat interface]
    API[API integration]
  end

  subgraph Ingestion["Ingestion layer"]
    ING[Normalize content<br/>web · PDF · video transcript · audio]
  end

  subgraph Orch["Multi-agent orchestrator"]
    ORC[Supervisor: routing · parallelism · merge · timeouts · escalation]
  end

  subgraph Shared["Shared structured context"]
    MEM[(Working memory:<br/>claims · entity IDs · scores · evidence IDs · open questions)]
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

  subgraph Stores["Persistence & intelligence"]
    KG[(Knowledge graph store)]
    DASH[(Dashboard memory<br/>entities · topics · bias patterns · interests)]
  end

  subgraph Models["AI/ML stack"]
    LLM[LLM · reasoning]
    NER_M[NER models]
    SENT[Sentiment / framing classifiers]
    RAG[RAG / retrieval]
  end

  subgraph Output["User-visible output"]
    UI[Structured UI:<br/>depolarized summary · framing signals · evidence · entities · gaps · next reads]
    VOICE[Voice-first layer]
  end

  EXT --> ING
  CHAT --> ING
  API --> ING

  ING --> ORC

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

  EXT_AG -.-> NER_M
  BIAS_AG -.-> SENT
  CRED_AG & RES_POOL & SYN -.-> LLM
  RES_POOL -.-> RAG

  SYN -->|one merged briefing| UI
  SYN --> VOICE

  ORC -.->|low confidence · conflicts · high-impact claims| RES_POOL
```

## Legend

- **Solid arrows**: primary data and orchestration paths (ingest → fan-out → merge → synthesis).
- **Dotted arrows**: model/tool usage and orchestrator **escalation** to research agents when confidence is low, claims conflict, or impact is high.
- **Shared structured context**: agents coordinate through a common representation (claims, entities, scores, evidence) rather than separate ad-hoc streams to the user.
- **Epistemic stance**: merged output is framed as **analysis with limits**, not infallible truth (PDR §1.5).
