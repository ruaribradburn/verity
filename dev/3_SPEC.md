# Specification: verity-phase-1-voice-analyst-ts

## User Stories
- As a user reading an article, I want Verity to understand the page I am on and answer spoken questions about bias, framing, and missing context without forcing me into a separate research workflow.
- As a user trying to think clearly, I want the assistant's language to stay uncertainty-calibrated and non-prescriptive so I receive context rather than instructions on what to believe.
- As a developer building the first slice, I want one TypeScript implementation path for session logic, tools, and shared types so I do not pay a cross-language integration cost before the product loop works.

## Requirements

### R1: Page context capture
- Requirement: WHEN the user activates Verity on a supported web page THEN the system shall capture the current page URL, metadata, and extracted readable text and send that context to the backend analysis session.
- Priority: Must
- Satisfies: A2
- Acceptance test: Open a supported page, activate Verity, and confirm the backend receives a structured page-context payload containing URL plus non-empty extracted text.

### R2: Live analysis session
- Requirement: WHEN the user starts a Verity session THEN the system shall establish a Gemini Live conversation loop with explicit session state, queued inbound message handling, and support for user speech or text input that returns an analysis response grounded in the current page context.
- Priority: Must
- Satisfies: A2
- Acceptance test: Start a session on an article, ask "What am I missing here?", and receive a response that references the active page rather than a generic answer.

### R3: Bias and omission analysis
- Requirement: WHEN the user asks for analysis of the current page THEN the system shall identify notable framing, bias signals, or omitted context from the available page content and present them in a concise response.
- Priority: Must
- Satisfies: A2
- Acceptance test: Provide a page fixture with one-sided framing and verify the response mentions at least one framing pattern, omitted context, or sourcing limitation tied to the page content.

### R4: Epistemic guardrails
- Requirement: WHEN Verity presents an assessment THEN the system shall use uncertainty-calibrated, non-prescriptive language and shall avoid presenting fringe claims as balanced alternatives to strong evidence.
- Priority: Must
- Satisfies: A3
- Acceptance test: Run prompt/response fixtures covering strong-evidence and contested-evidence cases and verify the response language includes uncertainty calibration and does not instruct the user what to think.

### R5: Bounded Phase 1 architecture
- Requirement: WHILE the system implements the first milestone the codebase shall keep persistent memory, research fan-out, and dashboard concerns outside the runtime-critical live interaction path.
- Priority: Must
- Satisfies: A1, A4
- Acceptance test: Inspect the repo structure and runtime path and confirm the first slice ships without requiring graph storage, sub-agent orchestration, or dashboard modules for core operation.

### R6: TypeScript-only foundation
- Requirement: WHILE the system implements the first milestone the codebase shall keep shared domain types, live session management, and tool execution in TypeScript without requiring Rust services, crates, or WASM modules.
- Priority: Should
- Satisfies: A4, A5
- Acceptance test: Inspect the repo structure and confirm the runtime path, shared models, and build setup are entirely TypeScript-based.

### R7: Extension-ready foundation
- Requirement: WHERE later phases add memory, sub-agents, or dashboard features the system shall expose shared domain types and clear module boundaries so those capabilities can be added without rewriting the Phase 1 interaction loop.
- Priority: Should
- Satisfies: A4, A5
- Acceptance test: Inspect shared models and module boundaries and confirm future features can plug into typed interfaces rather than patching ad hoc request shapes across the codebase.

### R8: Greenfield developer bootstrap
- Requirement: WHEN a contributor clones the repo THEN the system shall provide a clear bootstrap path for running the backend and browser client locally and validating the Phase 1 slice end to end.
- Priority: Should
- Satisfies: A5
- Acceptance test: Follow the documented local setup steps from a clean checkout and reach a runnable development environment without undocumented manual steps.

## Data Models

### PageContext
- `url: string`
- `title: string | null`
- `published_at: string | null`
- `site_name: string | null`
- `content_text: string`
- `selection_text: string | null`

### AnalysisRequest
- `page: PageContext`
- `mode: "on_demand" | "analyst" | "sentinel"`
- `user_prompt: string`

### AnalysisResponse
- `summary: string`
- `bias_signals: string[]`
- `missing_context: string[]`
- `confidence_notes: string[]`
- `follow_up_prompts: string[]`

### SessionState
- `"disconnected" | "connecting" | "connected" | "listening" | "processing" | "speaking" | "error"`

## API Contracts

### Extension -> backend
- Transport: Gemini Live client session plus app-local or backend APIs chosen during implementation.
- Contract:
  - `session.start`: opens a live analysis session.
  - `page.update`: sends the current `PageContext`.
  - `user.prompt`: sends the latest user utterance or text prompt.
  - `job.start`: starts non-live async analysis when a request is too heavy for the live turn.
  - `job.status`: retrieves the status of a previously started job.

### Backend -> extension/client
- `session.ready`: confirms the session is ready for analysis.
- `analysis.response`: returns an `AnalysisResponse`.
- `session.error`: returns a recoverable or fatal error with operator-readable detail.
 - `job.accepted`: confirms a background analysis job started.
 - `job.result`: returns a completed async analysis result.

## Acceptance Fixtures

### F1: Current-page grounding
- Input page: article text about an election with repeated references to campaign messaging but no mention of turnout or source methodology.
- User prompt: `What am I missing here?`
- Expected output shape:
  - Mentions the page's framing focus.
  - Flags at least one omitted context item such as turnout, methodology, or countervailing evidence.
  - Uses calibrated language such as "the article appears to emphasise" or "the available context here does not show".

### F2: Guardrail language
- Input page: article asserting a fringe health claim against broad scientific consensus.
- User prompt: `Show me the other side of this.`
- Expected output shape:
  - Acknowledges the user request.
  - Distinguishes between mainstream evidence and fringe counterclaims.
  - Avoids false balance language that treats unsupported claims as co-equal.

### F3: Session bootstrap
- Input page: any supported article page.
- User action: activate Verity and start a session.
- Expected output shape:
  - Session becomes ready.
  - Page payload is available to the backend.
  - A first analysis response can be produced without manual copy/paste of article text.

## Blast Radius
- User-visible impact: High
- Data/schema impact: No
- Rollback shape: Remove the new workspace and extension/server modules; no production migration required in the initial greenfield slice.
