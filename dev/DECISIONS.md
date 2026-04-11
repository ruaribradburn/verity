## D1: `dev/` should describe the code that exists now
- When: 2026-04-11
- Context: The previous `dev/` artifacts described a greenfield implementation plan that no longer matches the repository.
- Decision: Rewrite the `dev/` packet as a current-state architecture and documentation refresh grounded in the working tree.
- Alternatives: Preserve the old forward-looking plan; leave `dev/` as a stale historical artifact set.
- Revisit when: The team explicitly wants `dev/` to become a forward design workspace again instead of a current-state architecture packet.

## D2: Browser-owned Gemini Live sessions are the current implementation truth
- When: 2026-04-11
- Context: The code in `src/lib/live-session.ts` and `src/app/page.tsx` shows that the browser fetches an ephemeral token and opens the Gemini Live session directly.
- Decision: Document browser-owned live session management as the active architecture, with the API serving as token broker and config source.
- Alternatives: Describe the architecture as backend-owned or leave session ownership ambiguous.
- Revisit when: Session ownership moves behind the server or a second runtime surface becomes authoritative.

## D3: The Hono API is intentionally thin
- When: 2026-04-11
- Context: `src/server/index.ts` currently handles CORS, health/config/token endpoints, fixtures, validation, and deterministic analysis requests.
- Decision: Document the backend as a thin API boundary rather than implying a larger implemented orchestration service.
- Alternatives: Describe the server as if multi-agent orchestration, connector fan-out, or graph services already exist.
- Revisit when: The server gains materially broader responsibilities than the current endpoints support.

## D4: Deterministic analysis helpers are part of the present architecture
- When: 2026-04-11
- Context: `src/core/index.ts` contains the shared analysis models, deterministic analysis logic, fixture requests, and fixture assertions used by `/analyze`, `/fixtures`, and `/validate`.
- Decision: Treat the deterministic local analysis path as an intentional current capability and document it explicitly.
- Alternatives: Omit it from the architecture docs; describe it as if all analysis currently runs through Gemini Live.
- Revisit when: Deterministic analysis is removed, replaced, or substantially expanded into a richer structured backend analysis layer.

## D5: Product docs remain roadmap context, not implementation authority
- When: 2026-04-11
- Context: `notes.md` and `docs/PDR.md` still describe a broader Verity vision including extensions, graph persistence, richer research, dashboards, and multi-agent systems that are not implemented in the working tree.
- Decision: Use those files as future-direction context only and keep present-tense implementation claims grounded in current source files.
- Alternatives: Blend roadmap material into current-state docs without labeling the distinction.
- Revisit when: The implementation catches up to those roadmap concepts or the product-direction docs are themselves rewritten to match the shipped system.
