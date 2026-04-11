import { GoogleGenAI, Modality, type LiveServerMessage } from "@google/genai";
import {
  AsyncQueue,
  GEMINI_LIVE_API_VERSION,
  GEMINI_LIVE_MODEL,
  accumulateTranscript,
  buildLiveSystemInstruction,
  createLiveConfigSummary,
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
  sendContext(text: string): void;
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
};

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
    console.log("[verity/live] Fetching ephemeral token from:", `${options.apiOrigin}/live/token`);
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
    console.log("[verity/live] Token response status:", res.status);
    const body = (await res.json()) as LiveTokenHttpResponse;
    if (!res.ok || !body.ok) {
      const msg = body.ok
        ? `Failed to fetch ephemeral token (HTTP ${res.status}).`
        : [body.error, ...body.warnings].filter(Boolean).join(" ");
      console.error("[verity/live] Token request failed:", msg);
      throw new Error(msg);
    }
    console.log("[verity/live] Ephemeral token obtained successfully");
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

      if (msg.goAway) {
        lastError = `Live session should reconnect soon. Server time left: ${msg.goAway.timeLeft}ms.`;
      }

      emitSnapshot();
    }
  }

  return {
    async connect(page) {
      console.log("[verity/live] Connecting live session to:", options.apiOrigin);
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

      session = await ai.live.connect({
        model: GEMINI_LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          tools: [{ googleSearch: {} }],
          systemInstruction: {
            parts: [{ text: buildLiveSystemInstruction(page) }],
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
            console.log("[verity/live] Gemini Live WebSocket connected");
            state = "connected";
            emitSnapshot();
          },
          onmessage: (message) => {
            if (message.setupComplete) {
              console.log("[verity/live] Gemini Live setup complete");
              setupComplete.resolve();
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
      state = "processing";
      partialAssistantTranscript = "";
      session.sendRealtimeInput({ text });
      emitSnapshot();
    },

    sendContext(text) {
      if (!session) {
        throw new Error("Live session is not connected.");
      }
      session.sendClientContent({
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: false,
      });
      emitSnapshot();
    },

    sendAudioChunk(base64Pcm16) {
      if (!session) return;
      session.sendRealtimeInput({
        audio: {
          data: base64Pcm16,
          mimeType: "audio/pcm;rate=16000",
        },
      });
    },

    sendAudioStreamEnd() {
      if (!session) return;
      session.sendRealtimeInput({ audioStreamEnd: true });
    },

    sendVideoFrame(base64Jpeg) {
      if (!session) return;
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
