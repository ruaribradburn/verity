# Gemini Live Implementation Reference

This document is a practical implementation guide for building a Gemini Live based system with:

- real-time voice as the primary interaction surface
- optional text input and screen sharing
- local or backend-managed tool execution
- a richer outer orchestration loop for long-running or parallel non-live model work

It is written from the patterns used in this codebase, but generalized so you can recreate the same architecture for a different product.

This version also adds current TypeScript guidance for the Gemini Live API as of April 2026:

- use `@google/genai`, not `@google/generative-ai`
- use `gemini-3.1-flash-live-preview` for new work
- treat Gemini Live as a stateful WebSocket session
- use `sendRealtimeInput()` for runtime input on 3.1
- reserve `sendClientContent()` for seeded history
- plan for resumption and context compression early

## Current API Baseline

The Gemini Live API is a stateful, bidirectional streaming WebSocket API for voice, text, and visual interaction.

Install the SDK:

```bash
npm install @google/genai
```

Minimal initialization:

```ts
import {
  GoogleGenAI,
  Modality,
  LiveServerMessage,
  StartSensitivity,
  EndSensitivity,
  MediaResolution,
} from "@google/genai";

const ai = new GoogleGenAI({});

const explicit = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const vertex = new GoogleGenAI({
  vertexai: true,
  project: "your-gcp-project",
  location: "us-central1",
});
```

Use `apiVersion: "v1alpha"` if you need preview-only features.

### Model Choice

Live API requires Live-capable model IDs. Use `gemini-3.1-flash-live-preview` for new development.

| Model string | Status | Notes |
| --- | --- | --- |
| `gemini-3.1-flash-live-preview` | Recommended | Native audio, 128K context, `thinkingLevel` |
| `gemini-2.5-flash-native-audio-preview-12-2025` | Older active | Uses `thinkingBudget`, async function calling |
| `gemini-2.0-flash-live-001` | Shut down Dec 2025 | Do not target |
| `gemini-live-2.5-flash-preview` | Shut down Dec 2025 | Do not target |

For the SDK, pass the bare model string. For raw WebSocket setup messages, use `models/gemini-3.1-flash-live-preview`.

## What This Repo Actually Implements

The core runtime in this project lives in [src/context/GeminiLiveContext.tsx](/d:/argentic-mirror-ui-mockup/src/context/GeminiLiveContext.tsx:1).

The important parts are:

- `startSession()`: bootstraps a Gemini Live session, loads config, registers tools, and wires audio capture
- `processResponses()`: the main inbound message loop
- `sendTextMessage()`: sends non-audio user turns
- `startFrameCapture()`: streams screen-share frames as JPEG images
- `ToolRegistry`: maps model-exposed tool declarations to actual code executors
- `buildSystemPrompt()`: combines static instructions with current app state

The effective runtime loop is:

```text
user audio / text / screen frames
  -> Gemini Live session
  -> inbound websocket messages
  -> internal message queue
  -> response processor
     -> streamed assistant output
     -> optional tool calls
     -> local tool execution
     -> tool response back to Gemini
  -> Gemini completes the turn
  -> system returns to listening
```

That is the right mental model: a live conversational shell with tool round-trips, not a monolithic bespoke agent loop.

## Recommended Architecture

Split the system into three layers:

### 1. Live Interaction Layer

- microphone capture
- playback of model audio
- text input
- optional screen share
- session state and turn state
- streamed transcripts
- live tool calls

### 2. Tool Execution Layer

- UI actions
- data lookups
- transactional operations
- orchestration job launch
- orchestration job status retrieval

### 3. Outer Orchestration Layer

- parallel non-live model calls
- retrieval pipelines
- planning and decomposition
- background analysis
- durable job state
- retries, cancellation, audit, and observability

Gemini Live should be the front door and realtime coordinator, not the only reasoning engine in the system.

## The Core Agent Loop

The central implementation pattern in this repo is an event-driven queue processor.

Instead of handling all Gemini Live callbacks inline, incoming messages are placed into a queue and then consumed by one serial processor loop. That gives you:

- one place to reason about turn state
- ordered handling of tool calls, transcripts, interruptions, and turn completion
- less risk of race conditions between websocket callbacks and UI updates

### Minimal Queue

```ts
class AsyncQueue<T> {
  private items: T[] = [];
  private waiters: Array<(value: T) => void> = [];

  put(item: T) {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
      return;
    }
    this.items.push(item);
  }

  async get(): Promise<T> {
    if (this.items.length > 0) return this.items.shift()!;
    return new Promise(resolve => this.waiters.push(resolve));
  }

  clear() {
    this.items = [];
    this.waiters = [];
  }
}
```

### Session-Scoped Runtime State

Keep explicit state for:

- `sessionRef`
- `setupComplete`
- `messageQueue`
- `isMicEnabled`
- `isAgentSpeaking`
- partial user transcript
- partial assistant transcript
- playback queue
- latest session resumption handle

Do not infer session state from UI alone.

### Response Processor

```ts
async function processResponses() {
  while (sessionRef.current) {
    const message = await messageQueue.get();

    if (message.toolCall?.functionCalls) {
      await handleToolCalls(message.toolCall.functionCalls);
    }

    if (message.serverContent?.modelTurn?.parts) {
      handleModelTurn(message.serverContent.modelTurn.parts);
    }

    if (message.serverContent?.inputTranscription?.text) {
      handleUserTranscript(message.serverContent.inputTranscription.text);
    }

    if (message.serverContent?.outputTranscription?.text) {
      handleAssistantTranscript(message.serverContent.outputTranscription.text);
    }

    if (message.serverContent?.interrupted) {
      handleInterruption();
    }

    if (message.serverContent?.turnComplete) {
      finalizeAssistantTurn();
    }

    if (message.sessionResumptionUpdate?.newHandle) {
      storeResumeHandle(message.sessionResumptionUpdate.newHandle);
    }

    if (message.setupComplete !== undefined) {
      setupCompleteRef.current = true;
    }

    if (message.error) {
      handleSessionError(message.error);
    }
  }
}
```

## Bootstrapping a Live Session

The session bootstrap has five jobs:

1. resolve credentials
2. load model and tool configuration
3. build the live system prompt
4. connect to Gemini Live
5. start local capture and response processing

### Minimal Session Start

```ts
import { GoogleGenAI, Modality, MediaResolution } from "@google/genai";

async function startSession({
  apiKey,
  model,
  voiceName,
  systemInstruction,
  functionDeclarations,
}: {
  apiKey: string;
  model: string;
  voiceName: string;
  systemInstruction: string;
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: unknown;
  }>;
}) {
  const ai = new GoogleGenAI({ apiKey });

  const session = await ai.live.connect({
    model,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      tools: functionDeclarations.length ? [{ functionDeclarations }] : undefined,
    },
    callbacks: {
      onopen: () => console.log("Live session opened"),
      onmessage: msg => messageQueue.put(msg),
      onerror: err => console.error("Live error", err),
      onclose: evt => console.log("Live session closed", evt),
    },
  });

  sessionRef.current = session;
  setupCompleteRef.current = false;

  void processResponses();
}
```

Important notes:

- `responseModalities` should be either `[Modality.AUDIO]` or `[Modality.TEXT]`
- do not stream microphone audio before the session is ready
- treat the connection as a durable session object
- clear per-session accumulators on close

### Simple Turn Collector

```ts
async function waitForMessage(queue: LiveServerMessage[]): Promise<LiveServerMessage> {
  while (true) {
    const msg = queue.shift();
    if (msg) return msg;
    await new Promise(r => setTimeout(r, 50));
  }
}

async function collectTurn(queue: LiveServerMessage[]): Promise<LiveServerMessage[]> {
  const messages: LiveServerMessage[] = [];
  while (true) {
    const msg = await waitForMessage(queue);
    messages.push(msg);
    if (msg.serverContent?.turnComplete) break;
  }
  return messages;
}
```

## Authentication Patterns

Authentication strategy is an architectural choice, not a session-loop concern.

### Option A: Direct API Key in Browser

Best for prototypes, internal tools, and trusted environments. Simplest, but worst credential exposure model.

### Option B: Backend-Issued Ephemeral Token

Best for production browser or mobile clients.

```ts
const serverAi = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const token = await serverAi.authTokens.create({
  config: {
    uses: 1,
    expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    newSessionExpireTime: new Date(Date.now() + 60 * 1000).toISOString(),
    liveConnectConstraints: {
      model: "gemini-3.1-flash-live-preview",
      config: {
        responseModalities: [Modality.AUDIO],
        temperature: 0.7,
      },
    },
    httpOptions: { apiVersion: "v1alpha" },
  },
});

const clientAi = new GoogleGenAI({
  apiKey: token.name,
  apiVersion: "v1alpha",
});
```

Key points:

- ephemeral tokens are short-lived and single-use
- practical defaults are about 30 minutes expiry and about 1 minute to start a session
- constrained tokens can lock the client to a specific model and config

### Option C: Backend Proxy

Best when traffic must be brokered server-side for control, logging, or policy enforcement.

### Practical Rule

Do not let auth decisions leak into your session loop. Your live session should only depend on a credential that is already resolved.

## System Prompt and Dynamic Context

This repo builds the system prompt from:

- a static persona
- tool usage guidance
- current application state

That split is correct and generalizable.

```ts
function buildSystemPrompt(appState: {
  currentScreen: string;
  activeCaseId?: string;
  selectedItems: string[];
  hasData: boolean;
}) {
  const persona = `
You are a live voice assistant for warehouse operations.
Be concise, direct, and operationally useful.
`;

  const toolGuidelines = `
Use tools when the user asks for actions.
Confirm the result briefly.
Announce visible UI actions before triggering them.
`;

  const context = `
Current screen: ${appState.currentScreen}
Active case: ${appState.activeCaseId ?? "none"}
Selected items: ${appState.selectedItems.length}
Data loaded: ${appState.hasData ? "yes" : "no"}
`;

  return [persona, toolGuidelines, context].join("\n\n");
}
```

## Sending Multimodal Content

For `gemini-3.1-flash-live-preview`, the distinction between `sendRealtimeInput()` and `sendClientContent()` matters:

- use `sendRealtimeInput()` for runtime user input: audio chunks, video frames, and typed text
- use `sendClientContent()` for seeding prior conversation history

### Voice Input Pipeline

The repo uses browser audio capture with an `AudioWorklet`, downsampling mic input to the PCM format expected by the Live API.

Requirements:

- mono input
- PCM16 encoding
- 16kHz send rate
- little-endian audio

Recommended browser pipeline:

1. request microphone permission
2. create `AudioContext`
3. connect `MediaStreamAudioSourceNode`
4. process audio in an `AudioWorklet`
5. resample to 16kHz PCM16
6. base64-encode and send with `sendRealtimeInput`

Minimal send path:

```ts
function sendAudioChunk(session: any, pcm16ArrayBuffer: ArrayBuffer) {
  const base64 = arrayBufferToBase64(pcm16ArrayBuffer);

  session.sendRealtimeInput({
    audio: {
      data: base64,
      mimeType: "audio/pcm;rate=16000",
    },
  });
}
```

File-based example:

```ts
import * as fs from "node:fs";
import pkg from "wavefile";

const { WaveFile } = pkg;

const wav = new WaveFile();
wav.fromBuffer(fs.readFileSync("input.wav"));
wav.toSampleRate(16000);
wav.toBitDepth("16");

session.sendRealtimeInput({
  audio: {
    data: wav.toBase64(),
    mimeType: "audio/pcm;rate=16000",
  },
});

session.sendRealtimeInput({ audioStreamEnd: true });
```

Echo prevention is production-critical:

```ts
if (isAgentSpeakingRef.current) {
  return;
}
```

Do not force the browser capture context to 16kHz at creation time. Capture at the device rate and resample in the worklet.

### Text Input

For runtime text on 3.1:

```ts
session.sendRealtimeInput({
  text: "What do you see in my camera feed?",
});
```

For seeded history:

```ts
session.sendClientContent({
  turns: [
    { role: "user", parts: [{ text: "My name is Alex." }] },
    { role: "model", parts: [{ text: "Nice to meet you, Alex!" }] },
  ],
  turnComplete: false,
});
```

### Screen Share and Visual Context

This repo streams screen-share frames to Gemini Live as JPEG images. That is the correct general pattern if the assistant needs live visual context.

Throttle video aggressively. A practical upper bound is 1 FPS, and a single JPEG frame is roughly 258 tokens.

```ts
async function startScreenShare(session: any) {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
  });

  const video = document.createElement("video");
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  await video.play();

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  const interval = setInterval(() => {
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const base64Data = canvas.toDataURL("image/jpeg", 0.7).split(",")[1];

    session.sendRealtimeInput({
      video: {
        data: base64Data,
        mimeType: "image/jpeg",
      },
    });
  }, 1000);

  return () => {
    clearInterval(interval);
    stream.getTracks().forEach(track => track.stop());
  };
}
```

Practical guidance:

- scale deliberately before JPEG encoding
- expose `frameRate` and `jpegQuality` as settings
- do not assume native resolution is always best
- stop capture immediately when the user ends sharing

## Processing Server Responses

A robust message handler should treat each event as potentially containing:

- model output parts
- input or output transcription updates
- interruption signals
- tool calls
- session resumption updates
- usage metadata
- turn completion

```ts
function processMessage(msg: LiveServerMessage) {
  const content = msg.serverContent;

  if (content?.modelTurn?.parts) {
    for (const part of content.modelTurn.parts) {
      if (part.inlineData?.data) {
        const audioBytes = Buffer.from(part.inlineData.data, "base64");
        playAudio(audioBytes);
      }
      if (part.text) {
        appendTextResponse(part.text);
      }
    }
  }

  if (content?.inputTranscription?.text) {
    console.log("User said:", content.inputTranscription.text);
  }

  if (content?.outputTranscription?.text) {
    console.log("Model said:", content.outputTranscription.text);
  }

  if (content?.interrupted) {
    flushAudioPlaybackBuffer();
  }

  if (content?.turnComplete) {
    onTurnComplete();
  }

  if (msg.toolCall) {
    handleToolCall(msg.toolCall);
  }

  if (msg.goAway) {
    prepareForReconnection(msg.goAway.timeLeft);
  }

  if (msg.sessionResumptionUpdate?.newHandle) {
    storeResumeHandle(msg.sessionResumptionUpdate.newHandle);
  }

  if (msg.usageMetadata) {
    console.log("Tokens used:", msg.usageMetadata.totalTokenCount);
  }
}
```

Critical detail for 3.1: a single event may contain multiple parts, for example audio plus transcript text. Always iterate all parts.

### Assistant Audio Output

In this repo:

- audio chunks are decoded from base64
- converted to `Float32Array`
- queued for playback
- scheduled in a playback `AudioContext`

```ts
function enqueueAssistantAudio(float32Audio: Float32Array) {
  playbackQueue.push(float32Audio);
  if (!isPlaying) {
    void drainPlaybackQueue();
  }
}

async function drainPlaybackQueue() {
  isPlaying = true;
  isAgentSpeakingRef.current = true;

  while (playbackQueue.length > 0) {
    const chunk = playbackQueue.shift()!;
    const buffer = audioContext.createBuffer(1, chunk.length, 24000);
    buffer.copyToChannel(chunk, 0);

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start(nextStartTime);
    nextStartTime += buffer.duration;
  }

  isPlaying = false;
  scheduleMicReenableAfterPlayback();
}
```

Track when the assistant is still audibly speaking, not just when the API says generation is complete.

## Session Management, Resumption, and Compression

Long-running sessions need explicit lifecycle handling. Server disconnects around the 10 minute mark are a practical planning assumption.

### Session Resumption

Store the latest handle from `sessionResumptionUpdate` and reuse it when reconnecting:

```ts
let currentResumeHandle: string | null = null;

if (msg.sessionResumptionUpdate?.newHandle) {
  currentResumeHandle = msg.sessionResumptionUpdate.newHandle;
}

const session = await ai.live.connect({
  model: "gemini-3.1-flash-live-preview",
  config: {
    responseModalities: [Modality.AUDIO],
    sessionResumption: {
      handle: currentResumeHandle,
      transparent: true,
    },
  },
  callbacks: {},
});
```

Operational notes:

- transparent resumption can replay unconsumed messages
- resume handles are valid for roughly 2 hours on Gemini Developer API
- on Vertex AI they can last roughly 24 hours
- resumption implies cached server-side session state, so it may not fit zero-retention requirements

### Context Window Compression

The 128K context window can fill up quickly in long voice or multimodal sessions.

Useful intuition:

- audio input is about 25 tokens per second
- video frames are about 258 tokens per frame

Without compression:

- pure audio can fill the window in roughly 85 minutes
- audio plus 1 FPS video can fill it in only a few minutes

```ts
const config = {
  responseModalities: [Modality.AUDIO],
  contextWindowCompression: {
    slidingWindow: { targetTokens: 16384 },
    triggerTokens: 100000,
  },
  sessionResumption: { transparent: true },
};
```

In practice, resumption and compression should usually be enabled together for durable sessions.

## Tool Calling Architecture

This repo's tool system separates:

1. declarative tool definitions
2. runtime tool registry
3. concrete executors

That is the right structure. It lets you expose a clean schema to the model while keeping implementation details private and enforceable.

### Tool Declaration Example

```ts
const functionDeclarations = [
  {
    name: "lookup_order",
    description: "Fetch an order by id",
    parameters: {
      type: "object",
      properties: {
        orderId: { type: "string" },
      },
      required: ["orderId"],
    },
  },
  {
    name: "create_escalation",
    description: "Create a support escalation for a customer issue",
    parameters: {
      type: "object",
      properties: {
        accountId: { type: "string" },
        summary: { type: "string" },
        severity: { type: "string" },
      },
      required: ["accountId", "summary", "severity"],
    },
  },
];
```

### Tool Registry Example

```ts
type ToolExecutor = (args: unknown, deps: ToolDependencies) => Promise<unknown>;

class ToolRegistry {
  private executors = new Map<string, ToolExecutor>();
  private disabledTools = new Set<string>();

  constructor(
    private declarations: Array<{
      name: string;
      description: string;
      parameters: unknown;
    }>,
    private deps: ToolDependencies,
  ) {}

  registerExecutor(name: string, executor: ToolExecutor) {
    this.executors.set(name, executor);
  }

  setDisabledTools(names: string[]) {
    this.disabledTools = new Set(names);
  }

  getFunctionDeclarations() {
    return this.declarations.filter(d => !this.disabledTools.has(d.name));
  }

  async execute(name: string, args: unknown) {
    if (this.disabledTools.has(name)) {
      throw new Error(`Tool disabled: ${name}`);
    }

    const executor = this.executors.get(name);
    if (!executor) {
      throw new Error(`No executor registered for tool: ${name}`);
    }

    return executor(args, this.deps);
  }
}
```

### Handling Tool Calls

The 3.1 live model supports synchronous function calling and Google Search grounding. Tools must be declared when the session is created.

```ts
const session = await ai.live.connect({
  model: "gemini-3.1-flash-live-preview",
  config: {
    responseModalities: [Modality.AUDIO],
    tools: [
      { functionDeclarations },
      { googleSearch: {} },
    ],
  },
  callbacks: {
    onmessage: (msg: LiveServerMessage) => {
      if (msg.toolCall) {
        handleToolCalls(msg.toolCall.functionCalls);
      }
    },
  },
});

async function handleToolCalls(functionCalls: any[]) {
  const functionResponses = [];

  for (const call of functionCalls) {
    try {
      const result = await toolRegistry.execute(call.name, call.args);
      functionResponses.push({
        id: call.id,
        name: call.name,
        response: { result },
      });
    } catch (error: any) {
      functionResponses.push({
        id: call.id,
        name: call.name,
        response: { error: error.message ?? String(error) },
      });
    }
  }

  sessionRef.current.sendToolResponse({ functionResponses });
}
```

Live API-specific guidance:

- send function results with `sendToolResponse()`, not `sendClientContent()`
- synchronous function calls block generation until the results come back
- async function calling is available on older native-audio variants, not on `gemini-3.1-flash-live-preview`
- code execution and Google Maps tools are not supported in Live API sessions

## Voice Activity Detection and Interruption

The server performs automatic VAD by default. It detects user speech boundaries and can interrupt model output when the user barges in.

When `interrupted: true` arrives:

- stop local playback immediately
- flush any buffered assistant audio that has not been played yet
- return the UI toward listening

### VAD Tuning

```ts
const config = {
  responseModalities: [Modality.AUDIO],
  realtimeInputConfig: {
    automaticActivityDetection: {
      disabled: false,
      startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
      endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
      prefixPaddingMs: 200,
      silenceDurationMs: 1000,
    },
    activityHandling: "START_OF_ACTIVITY_INTERRUPTS",
  },
};
```

### Manual Speech Boundaries

```ts
const config = {
  realtimeInputConfig: {
    automaticActivityDetection: { disabled: true },
  },
};

session.sendRealtimeInput({ activityStart: {} });
session.sendRealtimeInput({
  audio: {
    data: base64Pcm,
    mimeType: "audio/pcm;rate=16000",
  },
});
session.sendRealtimeInput({ activityEnd: {} });
```

## Transcript and Turn Handling

Live systems receive partial content, not neat final messages.

You need explicit logic for:

- partial user transcription
- partial assistant transcription
- full accumulated transcript updates
- per-turn reset on `turnComplete`
- interruption handling

```ts
function accumulateTranscript(previous: string, incoming: string) {
  const next = incoming.trim();

  if (!previous) return next;
  if (next.startsWith(previous.trim())) return next;
  if (!next.includes(previous.trim())) return `${previous} ${next}`.trim();
  return next;
}
```

At `turnComplete`, finalize any partial assistant transcript, clear accumulation buffers, and return to listening.

## State Machine Recommendation

Use an explicit session state enum:

```ts
type SessionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "listening"
  | "processing"
  | "speaking"
  | "error";
```

This is operationally better than ad hoc booleans.

## The Outer Loop: Gemini Live as Front Door, Non-Live Agents Behind It

This is the most important design decision for a sophisticated system.

If you need parallel non-live calls, planning, retrieval, batch analysis, or durable jobs, do not force Gemini Live itself to become the whole orchestration engine.

Instead, make Gemini Live the interactive coordinator and expose the outer system through tools.

### Recommended Boundary

Gemini Live should own:

- conversational turn management
- immediate tool invocation
- real-time voice and screen-share UX
- short synchronous decisions

The outer orchestrator should own:

- long-running tasks
- parallel fan-out
- planning
- retries and cancellation
- durable job records
- result synthesis

### Minimal Async Job Surface

```ts
const orchestrationTools = [
  {
    name: "start_job",
    description: "Start a long-running analysis or planning job",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string" },
        prompt: { type: "string" },
        context: { type: "object" },
      },
      required: ["kind", "prompt"],
    },
  },
  {
    name: "get_job_status",
    description: "Get the current status of a previously started job",
    parameters: {
      type: "object",
      properties: {
        jobId: { type: "string" },
      },
      required: ["jobId"],
    },
  },
];
```

Strong pattern:

1. Gemini Live receives the request
2. Gemini Live decides it needs deeper work
3. Gemini Live calls `start_job`
4. the orchestrator launches parallel non-live tasks
5. Gemini Live tells the user the job has started
6. Gemini Live later calls `get_job_status`

## Pricing and Limits

Live API usage is token-priced rather than session-priced.

Indicative paid-tier pricing for `gemini-3.1-flash-live-preview`:

| Component | Cost per 1M tokens |
| --- | --- |
| Text input | $0.75 |
| Audio input | $3.00 |
| Image or video input | $1.00 |
| Text output including thinking | $4.50 |
| Audio output | $12.00 |

Useful planning numbers:

- voice-only conversation is around $0.023 per minute for audio input plus output combined
- adding continuous video at 1 FPS can push cost much higher
- Search grounding has separate usage and billing beyond free allowances

Rate limits are typically enforced per project across RPM, TPM, RPD, and IPM dimensions. Live preview limits can be tighter than stable model limits, so treat published values as indicative and verify the actual quotas for the project you deploy.

## Production Concerns

### 1. Observability

Log:

- session lifecycle
- tool call start and finish
- tool errors
- transcript boundaries
- turn completion
- background job lifecycle
- reconnect attempts
- `goAway` and resume-handle updates

### 2. Rate Limits and Backpressure

Apply control to:

- tool invocation frequency
- heavy query tools
- orchestration job creation
- screen-share frame rate
- audio queue length

### 3. Cancellation

Plan for:

- user ending the session mid-job
- user stopping screen share
- background job cancellation

### 4. Error Recovery

Handle:

- WebSocket close
- partial session setup
- microphone permission denial
- screen-share permission denial
- invalid tool arguments
- backend orchestration timeout
- `goAway` pre-disconnect signals
- resume handle expiry

### 5. Security

Protect:

- credentials
- screen-share permissions
- tool side effects
- backend mutation tools
- job result visibility

Never rely on prompt rules alone to constrain dangerous operations.

## Comprehensive End-to-End Example

```ts
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";
import * as fs from "node:fs";
import pkg from "wavefile";

const { WaveFile } = pkg;

const ai = new GoogleGenAI({});
const MODEL = "gemini-3.1-flash-live-preview";

let resumeHandle: string | null = null;
const responseQueue: LiveServerMessage[] = [];

async function waitMessage(): Promise<LiveServerMessage> {
  while (true) {
    const msg = responseQueue.shift();
    if (msg) return msg;
    await new Promise(r => setTimeout(r, 50));
  }
}

async function collectTurn(): Promise<LiveServerMessage[]> {
  const messages: LiveServerMessage[] = [];
  while (true) {
    const msg = await waitMessage();
    messages.push(msg);
    if (msg.serverContent?.turnComplete) break;
  }
  return messages;
}

async function main() {
  const session = await ai.live.connect({
    model: MODEL,
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: {
        parts: [{ text: "You are a concise, helpful voice assistant." }],
      },
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      contextWindowCompression: {
        slidingWindow: { targetTokens: 16384 },
        triggerTokens: 100000,
      },
      sessionResumption: resumeHandle
        ? { handle: resumeHandle, transparent: true }
        : { transparent: true },
    },
    callbacks: {
      onopen: () => console.log("Connected to Gemini Live API"),
      onmessage: (msg: LiveServerMessage) => {
        if (msg.sessionResumptionUpdate?.newHandle) {
          resumeHandle = msg.sessionResumptionUpdate.newHandle;
        }
        if (msg.goAway) {
          console.warn(`Server disconnecting in ${msg.goAway.timeLeft}ms`);
        }
        responseQueue.push(msg);
      },
      onerror: (e: ErrorEvent) => console.error("Error:", e.message),
      onclose: (e: CloseEvent) => console.log("Disconnected:", e.reason),
    },
  });

  const wav = new WaveFile();
  wav.fromBuffer(fs.readFileSync("question.wav"));
  wav.toSampleRate(16000);
  wav.toBitDepth("16");

  session.sendRealtimeInput({
    audio: { data: wav.toBase64(), mimeType: "audio/pcm;rate=16000" },
  });
  session.sendRealtimeInput({ audioStreamEnd: true });

  const turn = await collectTurn();
  const outputChunks: Buffer[] = [];

  for (const msg of turn) {
    const content = msg.serverContent;
    if (content?.modelTurn?.parts) {
      for (const part of content.modelTurn.parts) {
        if (part.inlineData?.data) {
          outputChunks.push(Buffer.from(part.inlineData.data, "base64"));
        }
      }
    }
    if (content?.inputTranscription?.text) {
      console.log("You:", content.inputTranscription.text);
    }
    if (content?.outputTranscription?.text) {
      console.log("Gemini:", content.outputTranscription.text);
    }
    if (content?.interrupted) {
      console.log("(interrupted by user)");
      outputChunks.length = 0;
    }
  }

  if (outputChunks.length > 0) {
    fs.writeFileSync("response.pcm", Buffer.concat(outputChunks));
    console.log("Audio response saved to response.pcm");
  }

  session.close();
}

main().catch(console.error);
```

## Implementation Checklist

Use this as a build order:

### Phase 1: Minimal Live Loop

- connect to Gemini Live
- send text
- receive assistant text
- handle `turnComplete`

### Phase 2: Voice

- microphone capture
- worklet-based resampling
- streamed audio input
- streamed audio output
- echo prevention

### Phase 3: Tools

- declarative tool definitions
- tool registry
- executor wiring
- tool response handling
- error handling and logging

### Phase 4: Screen Share

- display capture
- frame scaling
- JPEG encoding
- video chunk streaming
- explicit stop handling

### Phase 5: Outer Orchestrator

- async job model
- `start_job` and `get_job_status`
- parallel non-live workers
- durable job store
- result synthesis

### Phase 6: Production Hardening

- secure auth
- observability
- limits and backpressure
- cancellation
- retries
- session resumption
- context compression
- policy enforcement

## Common Failure Modes

### Live Loop Problems

- processing WebSocket callbacks directly instead of queueing them
- mixing session state and UI state
- not resetting accumulators on `turnComplete`
- not clearing state on session end
- not storing the latest resumption handle

### Audio Problems

- forcing an incompatible capture sample rate
- sending audio before setup is complete
- failing to suppress mic during playback
- forgetting `audioStreamEnd` or manual activity boundaries

### Screen Share Problems

- streaming too many large frames
- forgetting to stop tracks on user exit
- assuming visual context is unreliable because resolution is too low
- running continuous video without cost controls

### Tooling Problems

- oversized tools
- ambiguous schema
- slow synchronous tools that should be async jobs
- lack of disablement and rate limits
- trying to send tool results through client content

### Orchestration Problems

- trying to stuff long-running analysis into a live synchronous tool call
- no durable job ids
- no status polling path
- no cancellation model

## A Good Default Blueprint

```text
Frontend:
  - LiveSessionManager
  - AudioCapture
  - AudioPlayback
  - ScreenShareStreamer
  - TranscriptStore
  - ToolRegistryClient

Backend:
  - Credential broker
  - Tool APIs
  - Orchestrator service
  - Job store
  - Observability pipeline

Models:
  - Gemini Live for primary interaction
  - Gemma or other cheaper non-live models for batch/parallel workers
  - optional higher-capability synthesis model for final result composition
```

## Final Guidance

The most durable design lesson from this repo is this:

Build Gemini Live as a realtime interaction shell with a disciplined message loop, a narrow tool layer, and an explicit boundary to a slower outer orchestration system.

Do not try to make the live model be everything at once.

If the work is immediate, let Gemini Live do it through tools.

If the work is deep, parallel, slow, or durable, let Gemini Live initiate and supervise it through orchestration tools.

For current TypeScript implementations, three additional rules matter disproportionately:

- prefer `sendRealtimeInput()` over `sendClientContent()` for runtime input on 3.1
- combine session resumption with context compression for any session that may last more than a few minutes
- use ephemeral tokens whenever the client is untrusted

That separation gives you low-latency interaction, cleaner UX, scalable background reasoning, and easier debugging.

## Relevant Repo References

- Core live runtime: [src/context/GeminiLiveContext.tsx](/d:/argentic-mirror-ui-mockup/src/context/GeminiLiveContext.tsx:1)
- Tool registry: [src/lib/tools/registry.ts](/d:/argentic-mirror-ui-mockup/src/lib/tools/registry.ts:1)
- Tool dependency types: [src/lib/tools/types.ts](/d:/argentic-mirror-ui-mockup/src/lib/tools/types.ts:1)
- Prompt builder: [src/lib/config/system-prompt.ts](/d:/argentic-mirror-ui-mockup/src/lib/config/system-prompt.ts:1)
- Agent config: [config/agent.yaml](/d:/argentic-mirror-ui-mockup/config/agent.yaml:1)
- Tool declarations: [config/tools.yaml](/d:/argentic-mirror-ui-mockup/config/tools.yaml:1)
