import { GoogleGenAI, MediaResolution, Modality, FunctionResponse, type LiveServerMessage } from "@google/genai";
import {
  AsyncQueue,
  GEMINI_LIVE_API_VERSION,
  GEMINI_LIVE_MODEL,
  accumulateTranscript,
  buildLiveSystemInstruction,
  createLiveConfigSummary,
  createResearchToolDeclarations,
  type LiveTokenHttpResponse,
  type PageContext,
  type SessionState,
} from "@packages/core";

export type LiveSessionSnapshot = {
  state: SessionState;
  partialUserTranscript: string;
  partialAssistantTranscript: string;
  resumeHandle: string | null;
  lastError: string | null;
  turnCompleteCount: number;
  isConnected: boolean;
};

export type LiveSessionManager = {
  connect(page: PageContext): Promise<void>;
  sendText(text: string): void;
  /** Injects background context (e.g. research results) without ending the user turn. */
  sendContext(text: string, options?: { triggerResponse?: boolean }): void;
  /** Send a function response back to Gemini after handling a tool call. */
  sendToolResponse(id: string, name: string, response: Record<string, unknown>): void;
  sendAudioChunk(base64Pcm16: string): void;
  sendAudioStreamEnd(): void;
  sendVideoFrame(base64Jpeg: string): void;
  close(): void;
  getSnapshot(): LiveSessionSnapshot;
};

type ManagerOptions = {
  apiOrigin: string;
  onSnapshot(snapshot: LiveSessionSnapshot): void;
  onAudioChunk?(pcm24KhzChunk: Uint8Array): void;
  /** Called when Gemini requests a function call (e.g. research). Host should execute and call sendToolResponse. */
  onToolCall?(call: { id: string; name: string; args: Record<string, unknown> }): void;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
};

type LiveSessionHandle = {
  close(): void;
  sendClientContent(payload: {
    turns: Array<{
      role: "user" | "model";
      parts: Array<{ text: string }>;
    }>;
    turnComplete?: boolean;
  }): void;
  sendRealtimeInput(
    payload:
      | { text: string }
      | { audio: { data: string; mimeType: string } }
      | { video: { data: string; mimeType: string } }
      | { audioStreamEnd: true },
  ): void;
  sendToolResponse(params: { functionResponses: FunctionResponse[] | FunctionResponse }): void;
};

function safeStringifyForLog(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

const ENABLE_LIVE_VIDEO = true;
const ENABLE_PAGE_CONTEXT_INJECTION = false;
const ENABLE_DEBUG_LOGS = false;

let audioChunkLogCount = 0;
let videoFrameLogCount = 0;

function debugLog(message: string, payload?: unknown) {
  if (!ENABLE_DEBUG_LOGS) return;
  if (payload === undefined) {
    console.log(message);
    return;
  }
  console.log(message, payload);
}

export function createLiveSessionManager(options: ManagerOptions): LiveSessionManager {
  const queue = new AsyncQueue<LiveServerMessage>();
  const liveDefaults = createLiveConfigSummary();

  let session: LiveSessionHandle | null = null;
  let resumeHandle: string | null = null;
  let state: SessionState = "disconnected";
  let partialUserTranscript = "";
  let partialAssistantTranscript = "";
  let lastError: string | null = null;
  let turnCompleteCount = 0;

  function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((innerResolve, innerReject) => {
      resolve = innerResolve;
      reject = innerReject;
    });
    return { promise, resolve, reject };
  }

  async function waitForSetupComplete(setupCompletePromise: Promise<void>, timeoutMs = 10_000) {
    await Promise.race([
      setupCompletePromise,
      new Promise<never>((_, reject) => {
        window.setTimeout(() => {
          reject(new Error("Gemini Live did not report setup completion in time."));
        }, timeoutMs);
      }),
    ]);
  }

  function emitSnapshot() {
    options.onSnapshot({
      state,
      partialUserTranscript,
      partialAssistantTranscript,
      resumeHandle,
      lastError,
      turnCompleteCount,
      isConnected: session != null,
    });
  }

  async function fetchEphemeralToken() {
    debugLog("[verity/live] Fetching ephemeral token from:", `${options.apiOrigin}/live/token`);
    let res: Response;
    try {
      res = await fetch(`${options.apiOrigin}/live/token`, {
        method: "POST",
      });
    } catch (err) {
      console.error("[verity/live] Network error fetching token - is the API server running?", err);
      throw new Error(
        `Cannot reach API at ${options.apiOrigin}/live/token. From the repo root run \`bun run dev\` (starts web + API). ` +
          "If the error persists from the Chrome extension, confirm CORS allows chrome-extension origins (packages/api enables this by default).",
      );
    }
    debugLog("[verity/live] Token response status:", res.status);
    const body = (await res.json()) as LiveTokenHttpResponse;
    if (!res.ok || !body.ok) {
      const msg = body.ok
        ? `Failed to fetch ephemeral token (HTTP ${res.status}).`
        : [body.error, ...body.warnings].filter(Boolean).join(" ");
      console.error("[verity/live] Token request failed:", msg);
      throw new Error(msg);
    }
    debugLog("[verity/live] Ephemeral token obtained successfully");
    return body;
  }

  async function processMessages() {
    while (session) {
      const msg = await queue.get();

      if (msg.sessionResumptionUpdate?.newHandle) {
        resumeHandle = msg.sessionResumptionUpdate.newHandle;
      }

      if (msg.serverContent?.inputTranscription?.text) {
        partialUserTranscript = accumulateTranscript(
          partialUserTranscript,
          msg.serverContent.inputTranscription.text,
        );
      }

      if (msg.serverContent?.outputTranscription?.text) {
        partialAssistantTranscript = accumulateTranscript(
          partialAssistantTranscript,
          msg.serverContent.outputTranscription.text,
        );
        state = "speaking";
      }

      if (msg.serverContent?.modelTurn?.parts) {
        state = "speaking";
        for (const part of msg.serverContent.modelTurn.parts) {
          if (part.inlineData?.data && options.onAudioChunk) {
            options.onAudioChunk(base64ToBytes(part.inlineData.data));
          }
          if (part.text) {
            partialAssistantTranscript = accumulateTranscript(partialAssistantTranscript, part.text);
          }
        }
      }

      if (msg.serverContent?.interrupted) {
        state = "listening";
        partialAssistantTranscript = "";
      }

      if (msg.serverContent?.turnComplete) {
        state = "listening";
        turnCompleteCount += 1;
      }

      if (msg.toolCall?.functionCalls) {
        for (const fc of msg.toolCall.functionCalls) {
          if (fc.name && fc.id && options.onToolCall) {
            debugLog(`[verity/live] Gemini requested tool call: ${fc.name}`, fc.args);
            options.onToolCall({
              id: fc.id,
              name: fc.name,
              args: fc.args ?? {},
            });
          }
        }
      }

      if (msg.goAway) {
        lastError = `Live session should reconnect soon. Server time left: ${msg.goAway.timeLeft}ms.`;
      }

      emitSnapshot();
    }
  }

  return {
    async connect(page) {
      debugLog("[verity/live] Connecting live session to:", options.apiOrigin);
      state = "connecting";
      partialUserTranscript = "";
      partialAssistantTranscript = "";
      lastError = null;
      emitSnapshot();

      const token = await fetchEphemeralToken();
      const ai = new GoogleGenAI({
        apiKey: token.token,
        apiVersion: GEMINI_LIVE_API_VERSION,
      });
      const setupComplete = createDeferred<void>();
      const systemInstruction = buildLiveSystemInstruction(page);
      const toolDeclarations = createResearchToolDeclarations();

      console.log("[verity/live] Connect config:", {
        model: GEMINI_LIVE_MODEL,
        voiceName: liveDefaults.voiceName,
        languageCode: liveDefaults.speechLanguageCode,
        temperature: liveDefaults.temperature,
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
        responseModalities: [Modality.AUDIO],
        googleSearchEnabled: true,
        functionDeclarationCount: toolDeclarations.length,
        systemInstructionLength: systemInstruction.length,
        hasResumeHandle: Boolean(resumeHandle),
        enableLiveVideo: ENABLE_LIVE_VIDEO,
        enablePageContextInjection: ENABLE_PAGE_CONTEXT_INJECTION,
      });

      session = await ai.live.connect({
        model: GEMINI_LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
          tools: [
            { googleSearch: {} },
            // @ts-expect-error LiveFunctionDeclaration uses plain string types; the SDK expects its own Type enum but accepts strings at runtime.
            { functionDeclarations: toolDeclarations },
          ],
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
          speechConfig: {
            languageCode: liveDefaults.speechLanguageCode,
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: liveDefaults.voiceName,
              },
            },
          },
          temperature: liveDefaults.temperature,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: liveDefaults.realtimeInputConfig.automaticActivityDetectionDisabled,
              prefixPaddingMs: liveDefaults.realtimeInputConfig.prefixPaddingMs,
              silenceDurationMs: liveDefaults.realtimeInputConfig.silenceDurationMs,
            },
            // @ts-expect-error Live API typings use a narrower enum than our shared LiveConfigSummary string.
            activityHandling: liveDefaults.realtimeInputConfig.activityHandling,
          },
          contextWindowCompression: {
            slidingWindow: {
              targetTokens: String(liveDefaults.contextWindowCompression.targetTokens),
            },
            triggerTokens: String(liveDefaults.contextWindowCompression.triggerTokens),
          },
          sessionResumption: resumeHandle ? { handle: resumeHandle } : undefined,
        },
        callbacks: {
          onopen: () => {
            debugLog("[verity/live] Gemini Live WebSocket connected");
            state = "connected";
            emitSnapshot();
          },
          onmessage: (message) => {
            if (message.setupComplete) {
              debugLog("[verity/live] Gemini Live setup complete");
              setupComplete.resolve();
            }
            if (message.goAway) {
              console.warn("[verity/live] Gemini Live goAway:", {
                timeLeftMs: message.goAway.timeLeft,
              });
            }
            queue.put(message);
          },
          onerror: (error) => {
            console.error("[verity/live] Gemini Live WebSocket error:", error.message);
            state = "error";
            lastError = error.message;
            setupComplete.reject(error);
            emitSnapshot();
          },
          onclose: (event) => {
            const code = event?.code ?? 1000;
            const reason = typeof event?.reason === "string" ? event.reason : "";
            const wasClean = event?.wasClean ?? true;
            console.log(
              "[verity/live] Gemini Live WebSocket closed",
              `code=${code}`,
              `reason=${reason || "none"}`,
              `wasClean=${wasClean}`,
            );
            queue.clear();
            session = null;
            state = "disconnected";
            lastError =
              code === 1000 && !reason
                ? null
                : `Gemini Live disconnected (code ${code}${reason ? `: ${reason}` : ""}).`;
            setupComplete.reject(
              new Error(`Gemini Live closed (code ${code}${reason ? `: ${reason}` : ""}).`),
            );
            emitSnapshot();
          },
        },
      });

      await waitForSetupComplete(setupComplete.promise);
      console.log("[verity/live] Live session ready - state: listening");

      state = "listening";
      emitSnapshot();
      void processMessages();
    },

    sendText(text) {
      if (!session) {
        throw new Error("Live session is not connected.");
      }
      debugLog("[verity/live] sendRealtimeInput:text", {
        length: text.length,
        preview: text.slice(0, 160),
      });
      state = "processing";
      partialAssistantTranscript = "";
      session.sendRealtimeInput({ text });
      emitSnapshot();
    },

    sendContext(text, options) {
      if (!session) {
        throw new Error("Live session is not connected.");
      }
      const isPageContextHint = text.startsWith("[Current page context]");
      if (isPageContextHint && !ENABLE_PAGE_CONTEXT_INJECTION) {
        debugLog("[verity/live] sendClientContent:context skipped", {
          reason: "ENABLE_PAGE_CONTEXT_INJECTION=false",
          length: text.length,
          preview: text.slice(0, 160),
        });
        return;
      }
      debugLog("[verity/live] sendClientContent:context", {
        length: text.length,
        triggerResponse: Boolean(options?.triggerResponse),
        preview: text.slice(0, 160),
      });
      session.sendClientContent({
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: options?.triggerResponse ?? false,
      });
      if (options?.triggerResponse) {
        state = "processing";
        partialAssistantTranscript = "";
      }
      emitSnapshot();
    },

    sendToolResponse(id, name, response) {
      if (!session) return;
      debugLog(`[verity/live] Sending tool response for: ${name}`);
      debugLog("[verity/live] sendToolResponse:payload", {
        id,
        name,
        responsePreview: safeStringifyForLog(response).slice(0, 200),
      });
      const fr = new FunctionResponse();
      fr.id = id;
      fr.name = name;
      fr.response = response;
      session.sendToolResponse({ functionResponses: [fr] });
    },

    sendAudioChunk(base64Pcm16) {
      if (!session) return;
      if (ENABLE_DEBUG_LOGS && audioChunkLogCount % 100 === 0) {
        console.log("[verity/live] sendRealtimeInput:audio", {
          bytesBase64: base64Pcm16.length,
          chunkIndex: audioChunkLogCount,
        });
      }
      audioChunkLogCount += 1;
      session.sendRealtimeInput({
        audio: {
          data: base64Pcm16,
          mimeType: "audio/pcm;rate=16000",
        },
      });
    },

    sendAudioStreamEnd() {
      if (!session) return;
      debugLog("[verity/live] sendRealtimeInput:audioStreamEnd");
      session.sendRealtimeInput({ audioStreamEnd: true });
    },

    sendVideoFrame(base64Jpeg) {
      if (!session) return;
      if (!ENABLE_LIVE_VIDEO) {
        debugLog("[verity/live] sendRealtimeInput:video skipped", {
          reason: "ENABLE_LIVE_VIDEO=false",
          bytesBase64: base64Jpeg.length,
        });
        return;
      }
      if (ENABLE_DEBUG_LOGS && videoFrameLogCount % 10 === 0) {
        console.log("[verity/live] sendRealtimeInput:video", {
          bytesBase64: base64Jpeg.length,
          frameIndex: videoFrameLogCount,
        });
      }
      videoFrameLogCount += 1;
      session.sendRealtimeInput({
        video: {
          data: base64Jpeg,
          mimeType: "image/jpeg",
        },
      });
    },

    close() {
      queue.clear();
      session?.close();
      session = null;
      state = "disconnected";
      emitSnapshot();
    },

    getSnapshot() {
      return {
        state,
        partialUserTranscript,
        partialAssistantTranscript,
        resumeHandle,
        lastError,
        turnCompleteCount,
        isConnected: session != null,
      };
    },
  };
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
