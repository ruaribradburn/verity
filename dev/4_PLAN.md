# Plan: refresh-dev-docs-to-current-architecture

## Overview
Refresh the `dev/` workflow artifacts so they serve as an accurate current-state architecture packet. Replace the stale greenfield implementation plan with documentation centered on the implemented TypeScript repo, browser-owned Gemini Live session loop, thin Hono API, deterministic analysis helpers, and explicit separation between present code and future product direction.

## Traceability

| Scope | Spec | Plan | Test | Evidence |
|-------|------|------|------|----------|
| A1 | R1, R6 | T1, T2 | Working-tree comparison | E1 |
| A2 | R2, R3 | T2, T3 | Live-flow source comparison | E2 |
| A3 | R4, R6 | T2, T4 | Core/API source comparison | E3 |
| A4 | R5 | T3, T4 | Product-doc comparison | E4 |
| A5 | R7 | T1 | Scope/plan write-set review | E5 |

## Allowed Write Set
- `dev/0_SCOPE.md`
- `dev/1_REFERENCE.md`
- `dev/2_ANALYSIS.md`
- `dev/3_SPEC.md`
- `dev/4_PLAN.md`
- `dev/DECISIONS.md`

## Repo Hooks
- Decision: disabled
- Action: keep as-is

## Validation Loop
- Primary validation path: compare every architecture claim in the refreshed `dev/` docs against the current source files in `README.md`, `src/core/index.ts`, `src/lib/live-session.ts`, `src/app/page.tsx`, `src/server/index.ts`, `.env.example`, and `scripts/`.
- Supporting validation:
  - ensure present-tense repo layout claims match `rg --files`
  - ensure runtime media/auth/session flow matches the code
  - ensure future-direction items are explicitly labeled as deferred or aspirational
- Correction triggers:
  - if any `dev/` file still implies a Rust, WASM, extension, dashboard, or multi-agent runtime that is not in the repo
  - if the docs overstate backend responsibilities beyond what `src/server/index.ts` implements
  - if the docs blur the line between deterministic local analysis and future richer orchestration

## Engineering Qualities
- Maintainability: make `dev/` a reliable architecture snapshot rather than a stale historical plan.
- Developer-Friendliness: reduce onboarding ambiguity by aligning docs with actual file boundaries and run commands.
- Interpretability: separate implemented architecture from product-direction intent.
- Reliability: ground every major claim in a source file, not memory or older roadmap docs.

## Cleanup Tracking
- Remove obsolete greenfield assumptions from `dev/`.
- Avoid copying roadmap claims from `notes.md` or `docs/PDR.md` into present-tense implementation sections.
- Keep future-direction discussion concise and clearly labeled.

## Escalation Triggers
- If future code changes already underway in the worktree materially conflict with the current architecture snapshot.
- If the team wants `dev/` to continue serving as a forward-looking design workspace rather than a current-state architecture record.

## Tasks

### T1: Re-scope the artifact set as a documentation refresh
- [x] Status: completed
- Files: `dev/0_SCOPE.md`, `dev/4_PLAN.md`
- Depends on: -
- Satisfies: R1, R7
- Acceptance: Scope and plan define a docs-only write set and frame the task around current-state architectural alignment.

### T2: Rebuild references and analysis from current source files
- [x] Status: completed
- Files: `dev/1_REFERENCE.md`, `dev/2_ANALYSIS.md`
- Depends on: T1
- Satisfies: R1, R2, R4, R6
- Acceptance: Reference and analysis sections point at the actual implementation files and document the concrete architecture patterns now in use.

### T3: Rewrite the spec around implemented live-session behavior
- [x] Status: completed
- Files: `dev/3_SPEC.md`
- Depends on: T2
- Satisfies: R2, R3, R5
- Acceptance: The spec describes the browser-owned Gemini Live flow, runtime media path, and implemented-versus-aspirational boundary accurately.

### T4: Record the documentation decisions implied by the current codebase
- [x] Status: completed
- Files: `dev/DECISIONS.md`
- Depends on: T2
- Satisfies: R4, R5
- Acceptance: Key decisions explain why `dev/` now prioritizes current codebase truth over older roadmap assumptions.

## Implementation Order
T1 -> T2 -> T3 -> T4

## Done Means
- [x] Acceptance criteria updated to match the documentation task
- [x] `dev/` artifacts rewritten around current code patterns
- [x] Obsolete greenfield/Rust/extension assumptions removed from present-tense sections
- [x] Implemented-versus-future boundary made explicit
- [x] Write set narrowed to docs-only files
- [x] Decisions documented
- [x] No runtime code changed
