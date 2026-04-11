# Scope: verity-phase-1-voice-analyst-ts

## Statement
Build the first implementable Verity milestone as a voice-first browser copilot that captures the current page, streams a live Gemini Live conversation, and provides uncertainty-calibrated bias and missing-context analysis for the page the user is viewing. The shipped outcome for this task is a working Phase 1 "Voice Analyst" vertical slice built entirely in TypeScript, using a browser client plus TypeScript services and orchestration boundaries that can later grow into knowledge graph, research sub-agents, and dashboard capabilities without rewriting the live interaction loop.

## Current Session Boundaries
This turn produces workflow artifacts only. Implementation is intentionally deferred until the scope, analysis, specification, and plan are reviewed.

## In Scope
- Define the first shipped slice as the Phase 1 Voice Analyst described in `notes.md`.
- Implement the system in pure TypeScript with no Rust crates, WASM modules, or Rust services.
- Preserve the long-term product direction from the notes while constraining implementation to a bounded vertical slice.
- Establish the initial repository shape, Gemini Live session boundaries, and implementation order for the first milestone.
- Carry forward the key epistemic behaviors that make Verity distinct: calibrated uncertainty, non-prescriptive language, and bias/omission analysis.

## Out of Scope
- Persistent knowledge graph storage and cross-session memory.
- Parallel research sub-agents for source profiling, claim verification, historical context, or multi-region perspective scouting.
- Source reliability scoring beyond lightweight placeholders needed to explain future interfaces.
- Dashboard visualisation, timelines, graph exploration, and alerting.
- Production privacy, encryption, billing, multi-user tenancy, and deployment hardening beyond planning notes.
- Any Rust-based backend, shared-core crate, or WASM preprocessing layer.

## Acceptance Criteria
- A1: The implementation plan targets a bounded greenfield Phase 1 vertical slice rather than the entire multi-phase product roadmap.
- A2: The planned slice includes browser page capture, a TypeScript live interaction layer, and a live voice interaction loop that can analyse the current page content.
- A3: The planned behavior preserves Verity's epistemic rules by requiring calibrated uncertainty, non-prescriptive language, and avoidance of false balance for one-sided evidence.
- A4: The plan explicitly leaves a clean extension path for later phases covering entity graph memory, sub-agent fan-out, and dashboard features.
- A5: The artifacts define a concrete write set, TypeScript-first repository shape, and ordered implementation tasks suitable for a greenfield repo.

## Allowed Write Set
- `0_SCOPE.md`
- `1_REFERENCE.md`
- `2_ANALYSIS.md`
- `3_SPEC.md`
- `4_PLAN.md`
- `DECISIONS.md`
- `notes.md`
- `package.json`
- `tsconfig.json`
- `src/`
- `extension/`
- `dashboard/`
- `server/`
- `shared/`
- `.gitignore`
- `README.md`

## Repo Hooks
- Decision: disabled
- Why: Repo-local Codex hooks are unsupported in the current Windows Codex harness, so this task records hooks as disabled.

## Complexity
Medium

## Context
- Tags: product-notes, gemini-live, pure-typescript, greenfield, phase-1, browser-extension, live-voice
