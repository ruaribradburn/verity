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

type LiveSessionHandle = {
  close(): void;
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
    const res = await fetch(`${options.apiOrigin}/live/token`, {
      method: "POST",
    });
    const body = (await res.json()) as LiveTokenHttpResponse;
    if (!res.ok || !body.ok) {
      throw new Error(body.ok ? "Failed to fetch ephemeral token." : body.error);
    }
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

      session = await ai.live.connect({
        model: GEMINI_LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: {
            parts: [{ text: buildLiveSystemInstruction(page) }],
          },
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: liveDefaults.voiceName,
              },
            },
          },
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
            state = "connected";
            emitSnapshot();
          },
          onmessage: (message) => {
            queue.put(message);
          },
          onerror: (error) => {
            state = "error";
            lastError = error.message;
            emitSnapshot();
          },
          onclose: () => {
            state = "disconnected";
            emitSnapshot();
          },
        },
      });

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
