# Analysis: verity-phase-1-voice-analyst-ts

## Current State
- The repository currently contains only `notes.md`, which serves as the product requirements source.
- There is no TypeScript app scaffold, browser extension implementation, backend/service code, or generated runtime code.
- `git status --short` shows a deleted tracked `SCOPE.md`, so current planning artifacts should not assume any surviving prior workflow state.

## External Alignment
- The product notes describe a full multi-phase system, but `## 7. Development Phases` already segments the work into an initial Phase 1 that fits a greenfield first slice.
- `## 3. Moral & Epistemic Framework` supplies concrete behavioral constraints that should move from prose into hard requirements: calibrated uncertainty, non-prescriptive language, and no false equivalence.
- `### 5.2 The Two Loops` suggests a useful separation of concerns even in a reduced implementation: keep the voice/session path small and real-time, and defer heavy orchestration until later.
- `dev/geminilive-reference.md` supplies the concrete runtime shape for a pure TypeScript implementation: queue-based response processing, explicit session state, browser audio handling, tool registry separation, and async job boundaries for non-live work.

## Gap Analysis
| Gap | Current | Required | Approach |
|-----|---------|----------|----------|
| Repository structure | No app code | A repo shape that can host TypeScript browser and service code | Create a minimal TypeScript workspace with clear future extension points |
| Product boundary | Entire roadmap described in notes | A bounded first milestone | Scope the task to Phase 1 Voice Analyst only |
| Behavioral rules | Epistemic framework exists only as prose | Testable product requirements | Convert framework language into explicit requirements and fixtures |
| Voice interaction loop | Conceptual only | End-to-end Gemini Live session flow from page capture to spoken/text response | Specify extension capture, queue-based live session handling, and analysis response loop |
| Tool/orchestration boundary | Not implemented | Clear separation between live turn tools and slower async work | Adopt the reference doc's tool registry and async job boundary patterns |
| Future extensibility | Long-term architecture is described but absent | A plan that avoids rework when adding graph/sub-agent/dashboard phases | Reserve module boundaries and interfaces without implementing deferred systems |

## Integration Points
- `package.json`: workspace root for frontend and service packages.
- `src/` or `app/`: live session manager, transcript state, and UI shell.
- `extension/`: browser-side page capture and voice controls.
- `shared/`: shared request/response types and tool schemas.
- `server/`: optional token broker, tool APIs, and async job orchestration.
- `README.md`: bootstrap and verification workflow for a greenfield repo.

## Resolved Assumptions
- The first implementation target should be the notes' Phase 1 "Voice Analyst" milestone, not the full multi-phase platform.
- The planning package should preserve future extension points for entity graph, sub-agents, and dashboard work without implementing them now.
- The epistemic framework is part of the product definition and must be treated as functional behavior, not optional prompt flavor.
- Because the repo is greenfield, the first implementation can optimize for a single-user developer workflow before production hardening.
- The Gemini Live reference provides enough concrete implementation guidance to plan a TypeScript-first runtime without inventing a separate architecture.

## Unresolved Unknowns
None. Remaining product risks are captured as planned spikes or deferred decisions rather than blockers for specification.

## Blockers
None.

## Intentionally Deferred
- Exact provider validation for Gemini Live credential strategy and tool limits until implementation-time spike work.
- Persistent graph storage, multi-session memory, and semantic search.
- Parallel research sub-agents and multi-region coverage fan-out.
- Dashboard UI, graph visualisation, and source scoring systems.
- Production privacy, tenancy, encryption, and cost-control policies beyond what is needed for local development.
