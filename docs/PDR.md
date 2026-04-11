# Product Design / Requirements Document (PDR)

## Product Name: Real-Time Multimodal Intelligence Agent

---

# 1. Product Overview

## 1.1 Vision

Build an AI-powered real-time intelligence layer that augments user browsing by **surfacing how content is framed**, **mapping what is contested vs. better-supported**, surfacing missing context, and constructing a dynamic knowledge graph of entities and narratives—without presenting a single authoritative “correct” verdict on behalf of the user.

## 1.2 Mission

Enable users to think critically while consuming information by transforming passive browsing into active analysis.

## 1.3 Target Users

* Researchers & analysts
* Journalists
* Students
* Policy professionals
* Curious general users

## 1.4 Multi-Agent Product Position

Verity is a **multi-agent system**: specialized agents run in parallel, exchange structured findings with each other (not only with a single monolithic model), and converge on a **single user-facing result** that is fast to deliver and grounded in explicit verification steps.

**What we optimize for**

* **Coordination**: Clear handoffs (claims → verification → graph update → synthesis) so agents do not duplicate work or contradict each other.
* **Speed**: Parallel execution where tasks are independent; sequential steps only where dependencies require them.
* **Quality**: Disagreement and low-confidence paths are surfaced to dedicated agents (e.g. research / fact-check) before final output.

## 1.5 Epistemic stance & depolarized synthesis

The product **does not** optimize for telling the user “this is correct” or mirroring a polarized source’s framing as if it were neutral truth.

**Principles**

* **Depolarized read**: Where the source is emotionally loaded, partisan, or one-sided, synthesis aims for a **calmer, less inflammatory restatement** of what is being claimed—without endorsing it—and highlights **alternative framings** or stakeholder perspectives when evidence allows.
* **Evidence-weighted possibilities**: Prefer language of **support, uncertainty, and conflict** (e.g. what multiple reputable sources agree on, what is disputed, what cannot be verified) rather than binary true/false pronouncements.
* **No false certainty**: Confidence and limitations are **explicit**; the system presents **ranges of plausible readings** when the record is mixed, and flags when its own models or data are weak.
* **User agency**: The goal is **better judgment**, not delegated belief—the user remains responsible for conclusions; Verity supplies structure, context, and traceability.

This stance applies to **copy, synthesis prompts, and UI defaults** (tone, hedging, citation-first explanations).

---

# 2. Problem Statement

Users consume vast amounts of online content without tools to:

* Evaluate credibility
* Detect bias or manipulation
* Understand hidden relationships
* Identify missing perspectives

This leads to misinformation exposure, shallow understanding, and cognitive overload.

---

# 3. Solution Overview

A real-time assistant implemented as a **fleet of cooperating agents** that:

* Ingests web content (text, audio, visual)
* Extracts entities and builds a knowledge graph (dedicated extraction + graph agents)
* Analyzes bias and credibility (analysis agents with shared schemas for claims and scores)
* Runs **parallel verification and research agents** that share intermediate results (e.g. disputed claims, sources) via the orchestrator or a shared working memory
* **Synthesizes** a **depolarized, evidence-aware briefing** through an output agent that respects traceability back to each agent’s contribution—emphasizing what is **better supported**, what is **contested**, and what remains **unknown**, not a single “official truth.”
* Presents structured insights via a conversational interface

**User-visible outcome**: one coherent briefing with clear sections (see §5.3), produced quickly because work is split and pipelined across agents. Tone and structure default to **non-polarizing** and **epistemically humble** copy (see §1.5).

---

# 4. Core Features

## 4.1 Real-Time Content Ingestion

* Browser extension / API integration
* Supports:

  * Web pages
  * PDFs
  * Videos (transcripts)
  * Audio streams

## 4.2 Entity Extraction Engine

* Identifies:

  * People
  * Organizations
  * Locations
  * Events
  * Concepts
* Performs:

  * Named Entity Recognition (NER)
  * Entity disambiguation

## 4.3 Knowledge Graph Engine

* Dynamic graph construction
* Node types: entities
* Edge types:

  * Ownership
  * Influence
  * Contradiction
  * Collaboration
* Confidence scoring

## 4.4 Bias Detection System

* Surfaces **signals** of (not verdicts on):

  * Political or ideological lean in framing
  * Emotional language
  * Framing techniques
* Models used:

  * Sentiment analysis
  * Framing classifiers
* **Product use**: findings inform a **depolarized recap** and “what another neutral summary might emphasize”—not a label that the user should dismiss the source outright unless policy explicitly requires it.

## 4.5 Credibility Scoring

* Evaluates **heuristics** such as:

  * Source reputation
  * Historical reliability
  * Citation quality
* Outputs **confidence-style scores with caveats** (data freshness, domain, known blind spots)—presented as **supporting evidence for triage**, not as “this source is true/false.”

## 4.6 Multi-Agent Orchestration & Inter-Agent Communication

* **Orchestrator** (or supervisor): routes content and sub-tasks to the right agents, merges structured outputs, enforces timeouts and fallbacks, and triggers parallel work when safe.
* **Shared context**: agents read/write a **common representation** of the current analysis (e.g. extracted claims, entity IDs, confidence flags, open questions) so they **talk to each other through data**, not ad-hoc prose.
* **Message patterns**:

  * Request/response: e.g. “verify these claims” → research agents return evidence bundles.
  * Publish/subscribe style updates: graph agent consumes new entities from NER; scoring agents consume graph + source metadata.
  * Escalation: when bias/credibility scores conflict or confidence is low, orchestrator spawns or prioritizes verification agents before synthesis.

## 4.7 Parallel Research Agents

* Trigger conditions:

  * Low confidence
  * High-impact claims
  * Orchestrator-detected contradictions between agents
* Capabilities:

  * Cross-source verification
  * Opposing viewpoint retrieval
  * Checking claims against **multiple independent sources** where possible
* **Interoperability**: research agents accept **structured claim lists** from analysis agents and return **citable findings** (including **contradictions** and **gaps**) for the output/synthesis agent—so synthesis can state **what is better supported** without claiming final truth.

## 4.8 Gap Detection

* Identifies:

  * Missing stakeholders
  * Missing data
  * Alternative narratives

## 4.9 Intelligence Dashboard

* Persistent memory layer
* Tracks:

  * Entities
  * Topics
  * Bias patterns
  * User interests

## 4.10 Voice-First Output

* Concise spoken summaries
* Structured explanation format

---

# 5. User Experience

## 5.1 Entry Points

* Browser extension
* Chat interface
* API integration

## 5.2 Interaction Modes

* Passive mode (auto-analysis while browsing)
* Active mode (user queries)

## 5.3 Output Format

Sections should read as an **analytical briefing**, not a verdict. Default copy avoids “this is correct / this is false” unless operating under a narrow, policy-defined fact-checking mode; prefer **what is contested**, **what sources support**, and **confidence limits**.

1. **Summary (depolarized)**: Neutral restatement of the main claims and stakes; notes loaded or one-sided language without amplifying it.
2. **Framing & bias signals**: How the piece leans (emotion, omission, partisan cues)—as signals, with **alternative ways to describe the same issue** where useful.
3. **Evidence & credibility (heuristic)**: Source quality cues and **what can/cannot be verified** from available evidence—not a single trust score as gospel.
4. **Key entities & relationships**: Entities and how they connect (graph-backed where available).
5. **Missing context & opposing lines**: Gaps, missing stakeholders, and **good-faith counterarguments** or mainstream counter-narratives when relevant.
6. **What you might read next**: Suggestions for verification and perspective (primary sources, diverse outlets)—**recommendations**, not commands.

Voice and UI microcopy should reinforce §1.5 (no false certainty; user retains judgment).

## 5.4 Multi-Agent User Experience

* Users receive **one** primary response assembled by the synthesis agent (not a separate chat per agent).
* **Speed**: where helpful, show a short initial summary or loading state while verification agents finish, without blocking the entire UI on the slowest agent unless the claim is high-impact.
* **Trust**: later phases may expose “why this section” or per-agent contributions without overwhelming the default view; explanations should emphasize **evidence and limits**, not authority.

---

# 6. System Architecture

## 6.1 High-Level Components

1. Ingestion Layer
2. NLP Processing Layer (NER / extraction **agents**)
3. Knowledge Graph Service (graph **agent** + store)
4. **Multi-Agent Orchestrator** (routing, parallelism, merge, escalation)
5. Analysis **agents** (bias, framing, credibility)
6. Research / verification **agents** (parallel where possible)
7. **Synthesis / output agent** (single user-facing **briefing**: depolarized tone, uncertainty-aware, traceable to agents and sources—not a definitive “answer key”)
8. Frontend Interface

## 6.2 Data Flow

1. Input content → ingestion normalizes payload for agents.
2. Orchestrator fans out: entity extraction ∥ early claim/span detection (where applicable).
3. Graph agent updates knowledge graph; scores propagate to shared context.
4. Bias + credibility **analysis agents** write structured results; orchestrator detects conflicts or low confidence.
5. Research agents run **in parallel** on independent claim bundles; results merged with source pointers.
6. **Synthesis agent** produces one briefing from the shared representation (traceable to each upstream agent), applying **depolarized phrasing** and **explicit uncertainty** per §1.5.
7. User sees formatted output; optional voice layer reads the same structured result (same epistemic stance).

## 6.3 Multi-Agent Roles (illustrative)

| Role | Responsibility | Talks to |
| --- | --- | --- |
| Orchestrator | Task graph, timeouts, merge, escalation | All agents |
| Extraction / NER | Entities, spans, disambiguation hints | Graph, analysis |
| Graph | Nodes, edges, confidence | Scoring, synthesis |
| Bias / credibility | Scores, rationale snippets | Orchestrator, research, synthesis |
| Research | Evidence, corroboration, opposing views | Orchestrator, synthesis |
| Synthesis | Depolarized briefing, sectioning, citations, uncertainty | User (and voice layer) |

Agents **do not** each emit a separate chat stream to the user by default; the product presents **one** merged result, with optional drill-down into per-agent rationale in later phases. The merged result is **not** positioned as infallible truth; it is a **structured, sourced, humility-first** synthesis.

---

# 7. AI/ML Components

## 7.1 Models

* LLM (core reasoning)
* NER models
* Sentiment analysis models
* Bias classification models

## 7.2 Techniques

* Retrieval-Augmented Generation (RAG)
* Graph-based reasoning
* **Multi-agent orchestration** with explicit handoffs and a **shared structured state** (claims, entities, scores, evidence IDs) so agents coordinate without redundant LLM calls where possible
* Parallel tool-use and bounded concurrency for research agents to meet latency goals

---

# 8. Functional Requirements

## 8.1 Must Have (MVP)

* Webpage parsing
* Entity extraction
* Basic bias detection
* Simple credibility scoring
* Conversational output with **depolarized, uncertainty-aware** default tone (§1.5, §5.3)
* **At least two specialized agents plus orchestration** (e.g. extraction/analysis → synthesis), with a defined shared schema for passing results—even if research agents are minimal stubs initially

## 8.2 Should Have

* Knowledge graph visualization
* **Full parallel research agent pool** with orchestrator-driven escalation
* Dashboard persistence
* **Observable agent pipeline** (debug/audit: which agent contributed what)

## 8.3 Nice to Have

* Multimodal (video/audio)
* Real-time alerts
* Personalized bias tracking

---

# 9. Non-Functional Requirements

* Latency: < 2 seconds for **first user-visible** response where possible; orchestrator may stream partial summary while verification agents complete heavier work
* **Multi-agent efficiency**: bounded parallelism, deduplicated retrieval, and shared state to avoid redundant work across agents
* Scalability: handle concurrent users
* Privacy: local-first or secure processing
* Reliability: high uptime; graceful degradation if a sub-agent times out (orchestrator still returns partial structured result)

---

# 10. Risks & Challenges

* Hallucination risk
* Bias in AI models
* Data source reliability
* Performance overhead in real-time analysis
* **Multi-agent inconsistency**: without a strong shared schema and merge rules, agents may produce conflicting scores or duplicate verification; orchestrator and synthesis must resolve or surface uncertainty explicitly
* **False certainty / polarizing tone**: models may overstate confidence or echo partisan framing; **copy standards, synthesis prompts, and evals** must enforce §1.5 (depolarized, evidence-weighted, no “this is correct” by default)

---

# 11. Metrics of Success

* Quality of bias/framing signals (useful for users without being preachy or falsely objective)
* Calibration: user-facing uncertainty matches actual evidence strength where measurable
* **End-to-end latency** (ingest → final synthesized output) and **time-to-first-token** (if streaming)
* **Orchestration quality**: rate of unnecessary escalations, agent timeout rate, merge conflicts caught before user sees output
* User engagement time
* Retention rate
* Trust score from users

---

# 12. Roadmap

## Phase 1 (MVP)

* Browser extension
* Basic analysis
* **Orchestrator + multi-agent skeleton** (shared schema, synthesis from multiple agent outputs)

## Phase 2

* Knowledge graph
* **Parallel research agents** with inter-agent claim handoff and escalation rules

## Phase 3

* Full dashboard
* Personalization

---

# 13. Future Opportunities

* Enterprise intelligence tool
* API for journalists
* Integration with search engines

---

# End of Document
