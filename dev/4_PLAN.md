# Plan: verity-phase-1-voice-analyst-ts

## Overview
Implement a narrow end-to-end Phase 1 slice: browser page capture feeds a TypeScript Gemini Live session layer that returns grounded analysis responses shaped by explicit epistemic guardrails. Keep the runtime path small, use the queue-driven live loop and tool patterns from `dev/geminilive-reference.md`, and reserve graph, fan-out, and dashboard capabilities for later phases through shared types and module boundaries rather than premature implementation.

## Traceability

| Scope | Spec | Plan | Test | Evidence |
|-------|------|------|------|----------|
| A1 | R5 | T1, T2 | Workspace structure check | - |
| A2 | R1, R2, R3 | T2, T3, T4 | Page-context fixture, end-to-end session smoke test | - |
| A3 | R4 | T4, T5 | Response fixture tests | - |
| A4 | R5, R6, R7 | T1, T2, T5 | Module boundary review | - |
| A5 | R6, R7, R8 | T1, T5, T6 | Clean-start bootstrap walkthrough | - |

## Allowed Write Set
- `0_SCOPE.md`
- `1_REFERENCE.md`
- `2_ANALYSIS.md`
- `3_SPEC.md`
- `4_PLAN.md`
- `DECISIONS.md`
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
- Action: keep as-is

## Validation Loop
- Primary validation path: run the TypeScript app locally, load the browser extension or browser client against a real article page, start a Gemini Live session, and ask a known prompt such as `What am I missing here?`.
- Supporting validation:
  - unit tests for page-context extraction and request/response models
  - fixture-driven tests for epistemic guardrail response shaping
  - a local smoke path that logs session start, page ingestion, prompt receipt, queue processing, and response emission
- Guided tour:
  - start the TypeScript app or dev server
  - load the browser surface in developer mode
  - open a news article
  - activate Verity
  - ask one analysis question
  - confirm grounded response and visible logs
- Correction triggers:
  - if the implementation starts depending on graph storage or dashboard work to complete the first loop
  - if voice integration complexity blocks end-to-end validation, fall back temporarily to text input only with explicit approval rather than silently lowering the bar
  - if provider limitations prevent grounding on realistic page payloads, stop and revisit the session architecture before layering on more code
  - if the runtime starts mixing websocket callbacks, UI state, and tool execution without a queue boundary, stop and simplify the loop before adding features

## Engineering Qualities
- Maintainability: start with small, explicit TypeScript modules and typed request boundaries rather than a monolith with mixed browser, prompt, and transport logic.
- Extensibility: isolate shared analysis types so later graph, sub-agent, and dashboard work can reuse them.
- Developer-Friendliness: prioritize a simple local run path and visible logs over abstract infrastructure.
- Interpretability: encode epistemic rules in requirements, fixtures, and tests rather than leaving them buried in prompt prose.
- Reliability: make session and transport failures explicit with recoverable error messages and a simple observable smoke path.
- Performance: keep the Phase 1 loop lightweight; defer heavy orchestration and persistence from the critical path.

## Cleanup Tracking
- Avoid adding placeholder graph, dashboard, or sub-agent modules unless they are immediately needed for compilation boundaries.
- If debug endpoints, transcript dumps, or verbose trace logging are added for local validation, gate them behind a dev-only flag and record their removal trigger before release hardening.
- If an early text-only fallback is approved to unblock development, record a removal trigger tied to restoring the intended voice path.
- Avoid speculative server code if the first working slice can run safely with a client-side live session and a narrow TypeScript tool layer.

## Escalation Triggers
- Gemini Live client capabilities differ materially from the assumptions in `notes.md` or `dev/geminilive-reference.md`.
- The browser extension cannot reliably extract article text from target pages without a separate extraction strategy.
- End-to-end latency or streaming complexity pushes the implementation toward a mocked or degraded experience.
- The prompt layer cannot consistently satisfy the epistemic guardrail fixtures and needs a more structured analysis pipeline.

## Tasks

### T1: Bootstrap the TypeScript workspace foundation
- [ ] Status: pending
- Files: `package.json`, `tsconfig.json`, `README.md`, `.gitignore`, `src/`, `extension/`, `shared/`
- Depends on: -
- Satisfies: R5, R6, R7, R8
- Acceptance: The repo builds as a coherent TypeScript workspace with clear locations for live session code, shared types, and browser client code.
- Scope: ~120-200 lines

### T2: Implement shared domain models and Gemini Live session contracts
- [ ] Status: pending
- Files: `shared/`, `src/`
- Depends on: T1
- Satisfies: R1, R2, R5, R6, R7
- Acceptance: Typed models exist for `PageContext`, analysis requests, responses, session states, tool schemas, and live session events used across the app.
- Scope: ~150-250 lines

### T3: Build browser-side page capture and live session controls
- [ ] Status: pending
- Files: `extension/`, `src/`
- Depends on: T1, T2
- Satisfies: R1, R2
- Acceptance: The browser client can extract readable page text, start a live session, and send page updates and user prompts through the queue-driven interaction layer.
- Scope: ~250-450 lines

### T4: Build the TypeScript analysis session loop
- [ ] Status: pending
- Files: `src/`, `server/`
- Depends on: T1, T2
- Satisfies: R2, R3, R4, R5
- Acceptance: The live layer accepts session events, stores active page context, processes inbound messages through a queue, invokes analysis/tool flows, and returns structured responses grounded in the current page.
- Scope: ~300-500 lines

### T5: Add epistemic guardrail fixtures and local validation
- [ ] Status: pending
- Files: `src/`, `shared/`, `README.md`
- Depends on: T3, T4
- Satisfies: R4, R6, R7, R8
- Acceptance: Fixture-driven checks exist for calibrated language and grounded output, and the README documents a local smoke-test walkthrough.
- Scope: ~120-220 lines

### T6: Review cleanup and document deferred systems
- [ ] Status: pending
- Files: `README.md`, `DECISIONS.md`
- Depends on: T5
- Satisfies: R5, R6, R7, R8
- Acceptance: Deferred graph, sub-agent, dashboard, and production-hardening work is documented without leaving dead placeholder code or obsolete Rust assumptions in the repo.
- Scope: ~60-120 lines

## Implementation Order
T1 -> T2 -> T3 and T4 -> T5 -> T6

## Done Means
- [ ] All acceptance criteria (A*) verified
- [ ] Tests pass
- [ ] Lint clean
- [ ] Type check passes
- [ ] Visible validation path exercised or intentionally omitted with rationale
- [ ] Engineering-quality tradeoffs reviewed and acceptable
- [ ] Write set compliance (no out-of-scope changes, or deviations recorded)
- [ ] Decisions documented
- [ ] Cleanup completed or explicitly deferred with a removal trigger
- [ ] No hidden degraded/fallback/mock implementation was accepted without explicit approval
- [ ] Docs updated or deferred with rationale
- [ ] Telemetry/logging considered
- [ ] Migration/rollback considered (if applicable)
- [ ] Security considered (if applicable)
- [ ] Backward compatibility considered (if applicable)
