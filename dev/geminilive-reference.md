# Gemini Live Implementation Reference

This document is a practical implementation support guide for building a Gemini Live based system that uses:

- real-time voice as the primary interaction surface
- optional text input and screen sharing
- local or backend-managed tool execution
- a richer outer orchestration loop for long-running or parallel non-live model work

It is written from the patterns used in this codebase, but generalised so you can recreate the same architecture for a completely different use case.

It is not tied to intelligence analysis, graph UIs, or this repo's domain tools. The durable lessons here are about session management, streaming IO, tool calling, state handling, and orchestration boundaries.

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

For most real products, split the system into three layers:

### 1. Live Interaction Layer

This is the user-facing, low-latency loop:

- microphone capture
- playback of model audio
- text input
- optional screen share
- session state and turn state
- streamed transcripts
- live tool calls

This is where Gemini Live sits.

### 2. Tool Execution Layer

This is the bridge between the model and your application:

- UI actions
- data lookups
- transactional operations
- orchestration job launch
- orchestration job status retrieval

The model should never directly know how your application works. It should only know tool names, descriptions, and argument schemas.

### 3. Outer Orchestration Layer

This handles work that does not fit well into a live synchronous turn:

- parallel non-live model calls
- retrieval pipelines
- planning and subtask decomposition
- background analysis
- durable job state
- retries, cancellation, audit, and observability

Gemini Live should be the front door and realtime coordinator, not the only reasoning engine in the system.

## The Core Agent Loop

The central implementation pattern in this repo is an event-driven queue processor.

Instead of handling all Gemini Live callbacks inline, incoming messages are placed into a queue and then consumed by one serial processor loop.

That is a strong pattern because it gives you:

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
    if (this.items.length > 0) {
      return this.items.shift()!;
    }
    return new Promise(resolve => {
      this.waiters.push(resolve);
    });
  }

  clear() {
    this.items = [];
    this.waiters = [];
  }
}
```

### Session-Scoped Runtime State

Keep explicit state for:

- `sessionRef`: current live session object
- `setupComplete`: whether the live session is ready to accept streamed input
- `messageQueue`: inbound messages
- `isMicEnabled`
- `isAgentSpeaking`
- current partial user transcript
- current partial assistant transcript
- playback queue

Do not infer session state from UI alone.

### Response Processor

The core shape should look like this:

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

    if (message.serverContent?.turnComplete) {
      finalizeAssistantTurn();
    }

    if (message.serverContent?.interrupted) {
      handleInterruption();
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

That is the heart of the system.

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
          prebuiltVoiceConfig: {
            voiceName,
          },
        },
      },
      systemInstruction,
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      tools: functionDeclarations.length
        ? [{ functionDeclarations }]
        : undefined,
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

### Important Session Design Notes

- Do not start streaming microphone audio before the session is actually ready.
- Track `setupComplete` explicitly from the server event.
- Treat the websocket connection as a durable session object, not a stateless request channel.
- Reset per-session accumulators on close.
- Clear your message queue when ending a session.

## Authentication Patterns

Authentication strategy is an architectural choice, not a Gemini Live loop concern.

### Option A: Direct API Key in Browser

Best for:

- internal tools
- prototypes
- trusted environments

Pattern:

- resolve API key from local env or user settings
- instantiate `GoogleGenAI({ apiKey })` in the client

Tradeoff:

- simplest implementation
- worst credential exposure model

### Option B: Backend-Issued Ephemeral Token

Best for:

- production browser apps
- untrusted clients

Pattern:

1. browser requests a short-lived token from your backend
2. backend authenticates the user and requests or creates a live-capable credential
3. browser uses the returned token to establish the session

Tradeoff:

- more infrastructure
- materially safer deployment model

### Option C: Backend Proxy

Best for:

- tightly controlled enterprise environments
- centralised logging and policy enforcement
- cases where all traffic must stay brokered server-side

Tradeoff:

- more latency
- more complexity
- extra streaming infrastructure

### Practical Rule

Do not let auth decisions leak into your session loop. Your live session should only depend on a credential that is already resolved.

```ts
async function resolveLiveCredential(): Promise<string> {
  if (window.__EPHEMERAL_TOKEN__) return window.__EPHEMERAL_TOKEN__;
  if (localStorage.getItem("gemini_api_key")) return localStorage.getItem("gemini_api_key")!;
  throw new Error("No credential available");
}
```

## System Prompt and Dynamic Context

This repo builds the system prompt from:

- a static persona
- tool usage guidance
- current application state

That split is correct and generalisable.

### Recommended Prompt Structure

Use three layers:

1. durable behavioural rules
2. tool usage policy
3. dynamic runtime context

Example:

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

### Durable Lessons

- The prompt should contain just enough app state to help the model act well.
- Do not dump your entire database schema into every session prompt unless needed.
- Treat dynamic prompt context as a snapshot, not a real-time source of truth.
- Application correctness must still live in tools and code, not in prompt wording.

## Voice Input Pipeline

The repo uses browser audio capture with an `AudioWorklet`, downsampling mic input to the PCM format expected by the live API.

That is the right pattern for robust browser-side voice input.

### Requirements

- mono input
- PCM16 encoding
- 16kHz send rate

### Recommended Browser Pipeline

1. request microphone permission
2. create `AudioContext`
3. connect `MediaStreamAudioSourceNode`
4. process audio in an `AudioWorklet`
5. resample to 16kHz PCM16
6. base64-encode and send with `sendRealtimeInput`

### Minimal Send Path

```ts
function sendAudioChunk(session: any, pcm16ArrayBuffer: ArrayBuffer) {
  const base64 = arrayBufferToBase64(pcm16ArrayBuffer);

  session.sendRealtimeInput({
    audio: {
      data: base64,
      mimeType: "audio/pcm",
    },
  });
}
```

### Echo Prevention

This is a production-critical detail.

If you are playing assistant audio through speakers while the mic is open, your own app will often feed the model's speech back into the mic stream. That creates:

- echo
- accidental self-interruption
- repeated turn resets
- nonsense transcripts

The durable pattern is simple:

```ts
if (isAgentSpeakingRef.current) {
  return;
}
```

That exact idea is used in this repo before sending mic chunks.

### AudioContext Advice

Do not force the browser recording context to 16kHz at creation time. Many devices run at 44.1kHz or 48kHz and forcing the context rate can create capture issues. Capture at the device rate and resample in the worklet.

### Worklet Sketch

```ts
class MicProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    const pcm16 = downsampleAndConvertToPCM16(channel, sampleRate, 16000);
    this.port.postMessage({ type: "audio", data: pcm16.buffer }, [pcm16.buffer]);
    return true;
  }
}

registerProcessor("mic-processor", MicProcessor);
```

## Assistant Audio Output

Gemini Live can return audio in streamed chunks. In this repo:

- audio chunks are decoded from base64
- converted to `Float32Array`
- queued for playback
- scheduled in a playback `AudioContext`

This allows smooth playback instead of attempting to play each chunk immediately.

### Playback Pattern

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

The key design principle is to track when the assistant is still audibly speaking, not just when the API says generation is complete.

## Text Input

Text is useful even in a voice-first app because it gives you:

- fallback input
- dev and debugging convenience
- deterministic prompt injection for tests
- accessibility

### Minimal Text Turn

```ts
function sendTextMessage(session: any, text: string) {
  session.sendClientContent({
    turns: [
      {
        role: "user",
        parts: [{ text }],
      },
    ],
    turnComplete: true,
  });
}
```

### Design Advice

- Route text through the same session and log pipeline as voice.
- Keep transcript rendering consistent across text and speech.
- Avoid building a second parallel non-live chat loop unless there is a real need.

## Screen Share and Visual Context

This repo streams screen-share frames to Gemini Live as JPEG images.

That is the correct general pattern if your assistant needs live visual awareness of:

- the current UI
- external applications
- documents
- dashboards
- operator workflows

### Minimal Screen Share Loop

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
  }, 500);

  return () => {
    clearInterval(interval);
    stream.getTracks().forEach(track => track.stop());
  };
}
```

### Resolution Strategy

The repo uses configurable capture resolutions and optionally auto-detects whether the content is text-heavy or visual-heavy.

That is a smart tradeoff pattern:

- text-heavy content benefits from higher resolution
- visual content often tolerates lower resolution
- lower resolution reduces bandwidth and CPU cost

### Practical Guidance

- scale deliberately before JPEG encoding
- expose `frameRate` and `jpegQuality` as settings
- do not assume native resolution is always best
- stop capture immediately when the user ends sharing

## Tool Calling Architecture

This repo's tool system separates three concerns:

1. declarative tool definitions
2. runtime tool registry
3. concrete executors

That is the right structure.

### Why This Separation Matters

It lets you:

- expose a clean schema to the model
- keep implementation details private
- disable tools at runtime
- apply rate limits and policies
- reuse the same live loop across different domains

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

    const result = await executor(args, this.deps);
    return { success: true, result };
  }
}
```

### Handling Tool Calls

```ts
async function handleToolCalls(functionCalls: any[]) {
  const functionResponses = [];

  for (const call of functionCalls) {
    try {
      const result = await toolRegistry.execute(call.name, call.args);
      functionResponses.push({
        id: call.id,
        name: call.name,
        response: { result: result.result },
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

### Tool Design Guidance

Good tool properties:

- narrow surface area
- stable argument schema
- explicit side effects
- fast execution for synchronous tools
- easy-to-summarise results

Bad tool properties:

- giant overloaded "do_everything" tools
- raw arbitrary code execution
- ambiguous argument semantics
- tool names that encode internal implementation details

## Transcript and Turn Handling

Live systems receive partial content, not neat final messages.

You need explicit logic for:

- partial user transcription
- partial assistant transcription
- full accumulated transcript updates
- per-turn reset on `turnComplete`
- interruption handling

### Accumulation Pattern

In practice, the API may stream either:

- the full transcript accumulated so far
- or new fragments that must be appended

So you need defensive accumulation logic:

```ts
function accumulateTranscript(previous: string, incoming: string) {
  const next = incoming.trim();

  if (!previous) return next;
  if (next.startsWith(previous.trim())) return next;
  if (!next.includes(previous.trim())) return `${previous} ${next}`.trim();
  return next;
}
```

This pattern is directly relevant to both user and assistant transcript handling.

### Turn Completion

At `turnComplete`:

- finalise any partial assistant transcript
- clear assistant accumulation buffers
- move back to listening state

At assistant speech start:

- finalise the previous user transcript log entry

That keeps logs and transcript UI coherent per turn.

## State Machine Recommendation

Use an explicit session state enum.

Example:

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

Suggested interpretation:

- `connecting`: establishing websocket session
- `connected`: connected but not ready
- `listening`: ready for user input
- `processing`: user input sent, model is thinking or preparing
- `speaking`: assistant output is actively arriving or playing
- `error`: failed state requiring recovery

This is operationally better than ad hoc booleans.

## The Outer Loop: Gemini Live as Front Door, Non-Live Agents Behind It

This is the most important design decision for a sophisticated system.

If you need:

- parallel non-live Gemma calls
- multi-step planning
- retrieval pipelines
- batch analysis
- background jobs
- durable memory and resumable workflows

do not force Gemini Live itself to become the whole orchestration engine.

Instead, make Gemini Live the interactive coordinator and expose the outer system through tools.

### Recommended Boundary

Gemini Live should own:

- conversational turn management
- tool invocation for immediate actions
- real-time voice and screen-share UX
- short synchronous decisions

The outer orchestrator should own:

- long-running tasks
- parallel fan-out
- structured planning
- retries and cancellation
- durable job records
- result synthesis

### The Wrong Approach

The wrong design is:

- Gemini Live receives a request
- Gemini Live calls many heavy tools synchronously
- each tool blocks for a long time
- the user waits in an unclear live turn while background work drags on

This produces poor interaction quality.

### The Right Approach

The right design is:

1. Gemini Live receives the user request
2. Gemini Live decides this requires deep analysis
3. Gemini Live calls a tool like `start_research_job`
4. backend or local orchestrator launches parallel non-live tasks
5. Gemini Live tells the user the job has started
6. Gemini Live can later call `get_job_status`
7. when ready, Gemini Live summarises the finished result

### Job Tool Surface

A strong minimal async tool surface is:

- `start_job`
- `get_job_status`
- `cancel_job`
- `get_job_result`

Example declarations:

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

### Minimal Orchestrator

```ts
type JobStatus = "queued" | "running" | "complete" | "failed" | "cancelled";

interface JobRecord {
  id: string;
  kind: string;
  status: JobStatus;
  startedAt: number;
  finishedAt?: number;
  summary?: string;
  result?: unknown;
  error?: string;
}

class Orchestrator {
  private jobs = new Map<string, JobRecord>();

  startJob(kind: string, payload: unknown) {
    const id = crypto.randomUUID();
    this.jobs.set(id, {
      id,
      kind,
      status: "queued",
      startedAt: Date.now(),
    });

    void this.runJob(id, kind, payload);
    return id;
  }

  getJobStatus(id: string) {
    return this.jobs.get(id) ?? null;
  }

  private async runJob(id: string, kind: string, payload: unknown) {
    const job = this.jobs.get(id);
    if (!job) return;

    job.status = "running";

    try {
      const result = await this.executeKind(kind, payload);
      job.status = "complete";
      job.result = result;
      job.summary = summarizeResult(result);
      job.finishedAt = Date.now();
    } catch (error: any) {
      job.status = "failed";
      job.error = error.message ?? String(error);
      job.finishedAt = Date.now();
    }
  }

  private async executeKind(kind: string, payload: unknown) {
    switch (kind) {
      case "deep_research":
        return runParallelResearch(payload);
      case "plan_and_verify":
        return runPlanningWorkflow(payload);
      default:
        throw new Error(`Unknown job kind: ${kind}`);
    }
  }
}
```

### Parallel Non-Live Gemma Pattern

Suppose Gemini Live is your UX shell and Gemma models are your cheap, parallel worker layer.

A strong pattern is:

```ts
async function runParallelResearch(payload: any) {
  const [planner, retriever, critic] = await Promise.all([
    runGemmaPlanner(payload),
    runGemmaRetriever(payload),
    runGemmaCritic(payload),
  ]);

  return synthesizeResearchResult({
    planner,
    retriever,
    critic,
  });
}
```

The live model should not itself micromanage all those substeps token by token in a single live turn. It should invoke a tool that causes the orchestrator to do that work.

### How Gemini Live Should Talk About Async Jobs

Design your prompt and tool descriptions so the live model behaves well:

- For short tasks, do the work now.
- For long tasks, start a job and tell the user clearly.
- Use follow-up status checks rather than pretending to block synchronously.
- When results are ready, summarise them and offer next actions.

That gives you a clean split between:

- synchronous tool loop
- asynchronous orchestration loop

### Push Versus Poll

You have two implementation choices for surfacing async results back to the live agent.

#### Polling

Gemini Live asks `get_job_status`.

Best for:

- simpler systems
- user-driven follow-up
- minimal infrastructure

#### Push

Your app injects a new turn into the live session when a job completes:

```ts
session.sendClientContent({
  turns: [
    {
      role: "user",
      parts: [
        {
          text: `System update: job ${jobId} is complete. Result summary: ${summary}`,
        },
      ],
    },
  ],
  turnComplete: true,
});
```

Best for:

- proactive assistants
- monitored workflows
- operations dashboards

Risk:

- if overused, it can feel intrusive or confusing

A safe default is polling plus explicit user consent for proactive notifications.

## Recreating This for a Different Use Case

The domain changes. The loop does not.

### Example Use Cases

- customer support console
- medical scribe assistant
- warehouse operations copilot
- field service troubleshooting assistant
- software incident commander
- security operations voice assistant

In every case, the same live architecture applies:

- real-time session
- microphone pipeline
- optional screenshare
- transcript handling
- tool registry
- optional outer orchestrator

What changes is:

- tool schema
- dynamic context
- backend integrations
- policy and compliance rules

### Example: Warehouse Operations

Useful tools:

- `lookup_shipment`
- `reassign_picker`
- `create_delay_alert`
- `start_inventory_audit_job`
- `get_audit_job_status`

### Example: Customer Support

Useful tools:

- `lookup_customer`
- `get_recent_cases`
- `draft_refund_email`
- `start_root_cause_analysis_job`
- `get_root_cause_analysis_status`

### Example: Incident Response

Useful tools:

- `get_service_health`
- `query_logs`
- `create_incident_channel`
- `start_parallel_failure_analysis`
- `get_failure_analysis_status`

## Production Concerns

### 1. Observability

Log:

- session lifecycle
- tool call start and finish
- tool errors
- transcript boundaries
- turn completion
- background job lifecycle

You do not need to log every streamed token, but you do need enough structure to debug live behaviour.

### 2. Rate Limits and Backpressure

Apply control to:

- tool invocation frequency
- heavy query tools
- orchestration job creation
- screen-share frame rate
- audio queue length

This repo rate-limits tools in `ToolRegistry`. That is a good place for per-tool and per-category limits.

### 3. Cancellation

Plan for:

- model-issued tool call cancellation
- user ending the session mid-job
- user stopping screen share
- background job cancellation

### 4. Error Recovery

Handle:

- websocket close
- partial session setup
- microphone permission denial
- screen-share permission denial
- invalid tool arguments
- backend orchestration timeout

### 5. Security

Protect:

- credentials
- screen-share permissions
- tool side effects
- backend mutation tools
- job result visibility

Never rely on prompt rules alone to constrain dangerous operations.

### 6. Human Factors

Live voice systems fail when state is unclear.

Always make it obvious when the assistant is:

- listening
- speaking
- waiting
- running a background job
- unable to act

## Implementation Checklist

Use this as a build order.

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
- policy enforcement

## Common Failure Modes

### Live Loop Problems

- processing websocket callbacks directly instead of queueing them
- mixing session state and UI state
- not resetting accumulators on `turnComplete`
- not clearing state on session end

### Audio Problems

- forcing an incompatible capture sample rate
- sending audio before setup is complete
- failing to suppress mic during playback

### Screen Share Problems

- streaming too many large frames
- forgetting to stop tracks on user exit
- assuming visual context is reliable without enough resolution

### Tooling Problems

- oversized tools
- ambiguous schema
- slow synchronous tools that should be async jobs
- lack of disablement and rate limits

### Orchestration Problems

- trying to stuff long-running background analysis into a live synchronous tool call
- no durable job ids
- no status polling path
- no cancellation model

## A Good Default Blueprint

If you are starting from scratch for a new product, this is a strong default:

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

That separation gives you:

- low-latency interaction
- clean live UX
- scalable background reasoning
- better reliability
- easier debugging
- cleaner product evolution across domains

## Relevant Repo References

- Core live runtime: [src/context/GeminiLiveContext.tsx](/d:/argentic-mirror-ui-mockup/src/context/GeminiLiveContext.tsx:1)
- Tool registry: [src/lib/tools/registry.ts](/d:/argentic-mirror-ui-mockup/src/lib/tools/registry.ts:1)
- Tool dependency types: [src/lib/tools/types.ts](/d:/argentic-mirror-ui-mockup/src/lib/tools/types.ts:1)
- Prompt builder: [src/lib/config/system-prompt.ts](/d:/argentic-mirror-ui-mockup/src/lib/config/system-prompt.ts:1)
- Agent config: [config/agent.yaml](/d:/argentic-mirror-ui-mockup/config/agent.yaml:1)
- Tool declarations: [config/tools.yaml](/d:/argentic-mirror-ui-mockup/config/tools.yaml:1)
