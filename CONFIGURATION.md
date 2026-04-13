# Verity Gemini Live Configuration

This document explains how to configure the Gemini Live Multimodal session parameters and how they affect the model's behavior.

## Core LLM Parameters

These settings are resolved from the `.env` file and passed to the Gemini Live session at connect time.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `GEMINI_LIVE_VOICE` | string | `Erinome` | The prebuilt voice used for audio output. Options include: `Erinome`, `Puck`, `Charon`, `Kore`, `Fenrir`, `Aoede`. |
| `GEMINI_LIVE_SPEECH_LANGUAGE_CODE` | string | `en-GB` | The BCP-47 language code for speech recognition and synthesis. |
| `GEMINI_LIVE_TEMPERATURE` | number | `0.55` | Controls randomness. Lower is more predictable; higher is more creative. |
| `GEMINI_LIVE_TOP_P` | number | `0.95` | Nucleus sampling. |
| `GEMINI_LIVE_TOP_K` | number | `40` | Limits sampling to the top K most likely tokens. |
| `GEMINI_LIVE_AFFECTIVE_DIALOG` | boolean| `true` | Enables natural emotional prosody in the generated speech. |

## Prompt Overrides (Markdown Files)

Verity reads specific markdown files from the `prompts/` directory at startup. These files act as high-priority overrides for the model's system instructions.

1.  **`prompts/accent.md`**:
    *   **Affects**: Vocal character, specific regional accents, and speech patterns.
    *   **Insertion**: Injected into the `Vocal Character & Accent Overrides` section of the system instruction.
2.  **`prompts/style.md`**:
    *   **Affects**: Personality, behavioral constraints, tone of voice, and interactive style.
    *   **Insertion**: Injected into the `Behavioral Persona & Cognitive Style` section of the system instruction.

### How it's inserted into the System Instruction

The final system instruction is built dynamically in `packages/core/index.ts` using the following hierarchy:

1.  **Hard Rules**: Unchangeable core directives (e.g., "NEVER ask clarifying questions").
2.  **Identity**: Standard Verity identity ("You are Verity...").
3.  **Accent Overrides**: Loaded from `prompts/accent.md`.
4.  **Personality Overrides**: Loaded from `prompts/style.md`.
5.  **Core Loop**: Procedural instructions for analysis and tool use.
6.  **Page Context**: Dynamic data about the currently viewed webpage.

## Implementation Details

- **Server-side**: The Hono API (`packages/api/src/index.ts`) reads the files and environment variables, merging them into a `LiveConfigSummary`.
- **Client-side**: The session manager (`packages/client/src/live-session.ts`) fetches this configuration from the `/live/config` endpoint before establishing the WebSocket connection to Gemini.
