## D1: First milestone is Phase 1, not the full roadmap
- When: 2026-04-11
- Context: The product notes describe a broad multi-phase system, but the repo is greenfield and currently contains only the notes.
- Decision: Scope the first implementation task to the notes' Phase 1 "Voice Analyst" vertical slice while preserving extension points for later phases.
- Alternatives: Plan the full graph, sub-agent, and dashboard platform at once; treat the task as documentation-only with no concrete implementation boundary.
- Revisit when: Phase 1 is working end to end and the repo is ready to begin persistent memory or research fan-out work.

## D2: The implementation path is pure TypeScript
- When: 2026-04-11
- Context: The original planning pass assumed Rust services and shared code, but the implementation direction has now changed.
- Decision: Build the first milestone entirely in TypeScript and remove Rust, crates, and WASM from the current task scope.
- Alternatives: Keep the mixed Rust plus TypeScript design; use Rust only for selected performance-sensitive paths.
- Revisit when: Real performance data or deployment constraints show that TypeScript cannot support the required user experience.

## D3: Repo-local hooks remain disabled
- When: 2026-04-11
- Context: The context-engineering skill expects a repo-hooks decision, but the current Codex harness on Windows does not support repo-local hooks cleanly.
- Decision: Record hooks as disabled for this task and keep the workflow manual.
- Alternatives: Pretend hooks are enabled; attempt to enforce unsupported repo-local hook behavior.
- Revisit when: The project is worked on from a harness/platform that supports repo-local Codex hooks.

## D4: Manual artifact creation instead of `ce init`
- When: 2026-04-11
- Context: The skill workflow recommends `ce init`, but local PowerShell execution policy and the Git Bash bridge failed during initialization in this environment.
- Decision: Create the phase artifacts manually in the skill's format for this planning pass.
- Alternatives: Block the task on local `ce` initialization; invent a different artifact structure.
- Revisit when: The `ce` tooling can run successfully in this repo and the workflow can be migrated onto generated task scaffolding.

## D5: Gemini Live reference is the primary runtime architecture source
- When: 2026-04-11
- Context: The repo now includes `dev/geminilive-reference.md`, which contains concrete implementation guidance for the live session loop, audio pipeline, tool registry, and async orchestration boundary.
- Decision: Use that reference as the architectural baseline for the first TypeScript implementation pass.
- Alternatives: Infer a fresh runtime design from the product notes alone; overfit the architecture to speculative later-phase capabilities.
- Revisit when: Implementation reveals a mismatch between the reference patterns and Verity's actual product needs.
