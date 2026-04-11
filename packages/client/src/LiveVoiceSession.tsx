"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Information,
  Microphone,
  Screen,
  SendAlt,
  Settings,
  Stop,
} from "@carbon/icons-react";
import type { LiveConfigHttpResponse, PageContext, PageHydrationHttpResponse } from "@packages/core";
import {
  createLiveSessionManager,
  type LiveSessionManager,
  type LiveSessionSnapshot,
} from "./live-session";

export type LiveVoiceSessionProps = {
  /** Base URL of `packages/api` (no trailing slash), e.g. http://127.0.0.1:3001 */
  apiOrigin: string;
};

type TranscriptEntry = {
  id: string;
  role: "system" | "user" | "assistant";
  text: string;
  meta?: string;
};

type ScreenShareHandle = {
  captureFrame(): string | null;
  startStreaming(manager: LiveSessionManager): void;
  stop(): void;
};

const INITIAL_PAGE: PageContext = {
  url: "Screen share session",
  title: "Current browsing session",
  siteName: "live-share",
  publishedAt: null,
  selectionText: null,
  contentText:
    "Screen sharing is active. Verity should reason about the user's current browsing context from live frames and voice interaction.",
};

export function LiveVoiceSession({ apiOrigin }: LiveVoiceSessionProps) {
  const base = apiOrigin.replace(/\/$/, "");

  const managerRef = useRef<LiveSessionManager | null>(null);
  const screenCleanupRef = useRef<(() => void) | null>(null);
  const micCleanupRef = useRef<(() => void) | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackCursorRef = useRef(0);
  const lastTurnCountRef = useRef(0);
  const snapshotRef = useRef<LiveSessionSnapshot>({
    state: "disconnected",
    partialUserTranscript: "",
    partialAssistantTranscript: "",
    resumeHandle: null,
    lastError: null,
    turnCompleteCount: 0,
    isConnected: false,
  });

  const [liveConfig, setLiveConfig] = useState<LiveConfigHttpResponse | null>(null);
  const [snapshot, setSnapshot] = useState<LiveSessionSnapshot>({
    state: "disconnected",
    partialUserTranscript: "",
    partialAssistantTranscript: "",
    resumeHandle: null,
    lastError: null,
    turnCompleteCount: 0,
    isConnected: false,
  });
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([
    {
      id: "intro",
      role: "system",
      text: "Start a screen share and voice session. Once connected, Verity should watch what you are browsing and respond in voice.",
      meta: "ready",
    },
  ]);
  const [typedInput, setTypedInput] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [starting, setStarting] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(true);

  useEffect(() => {
    void fetch(`${base}/live/config`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setLiveConfig(data))
      .catch(() => setLiveConfig(null));
  }, [base]);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    if (snapshot.turnCompleteCount === 0 || snapshot.turnCompleteCount === lastTurnCountRef.current) {
      return;
    }

    lastTurnCountRef.current = snapshot.turnCompleteCount;
    setTranscript((current) => {
      const next = [...current];
      if (snapshot.partialUserTranscript.trim()) {
        next.push({
          id: `user-${snapshot.turnCompleteCount}`,
          role: "user",
          text: snapshot.partialUserTranscript.trim(),
          meta: "voice",
        });
      }
      if (snapshot.partialAssistantTranscript.trim()) {
        next.push({
          id: `assistant-${snapshot.turnCompleteCount}`,
          role: "assistant",
          text: snapshot.partialAssistantTranscript.trim(),
          meta: "live response",
        });
      }
      return next;
    });
  }, [snapshot.partialAssistantTranscript, snapshot.partialUserTranscript, snapshot.turnCompleteCount]);

  useEffect(() => {
    return () => {
      stopSession();
    };
  }, []);

  async function startSession() {
    if (starting || snapshot.isConnected) return;

    setStarting(true);
    let microphoneStream: MediaStream | null = null;
    try {
      const manager = createLiveSessionManager({
        apiOrigin: base,
        onSnapshot: (next) => {
          snapshotRef.current = next;
          setSnapshot(next);
        },
        onAudioChunk: enqueueAssistantAudio,
      });
      managerRef.current = manager;

      const screenShare = await createScreenShareHandle();
      screenCleanupRef.current = () => screenShare.stop();

      const hydrated = await hydratePageContext({
        apiOrigin: base,
        fallbackPage: buildPageContext(pageUrl, pageTitle),
        screenshotBase64: screenShare.captureFrame(),
      });

      await manager.connect(hydrated.page);
      screenShare.startStreaming(manager);
      microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await startMicrophone(manager, microphoneStream);
      microphoneStream = null;

      if (hydrated.page.url !== INITIAL_PAGE.url) {
        setPageUrl(hydrated.page.url);
      }
      if (hydrated.page.title) {
        setPageTitle(hydrated.page.title);
      }

      setTranscript((current) => [
        ...current,
        {
          id: `session-${Date.now()}`,
          role: "system",
          text: [
            "Live session connected. Screen frames and microphone audio are now being streamed to Gemini Live.",
            hydrated.message,
            ...hydrated.warnings,
          ]
            .filter(Boolean)
            .join(" "),
          meta: "connected",
        },
      ]);
    } catch (error) {
      setTranscript((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          role: "system",
          text: formatStartSessionError(error),
          meta: "error",
        },
      ]);
      microphoneStream?.getTracks().forEach((track) => track.stop());
      stopSession();
    } finally {
      setStarting(false);
    }
  }

  function stopSession() {
    screenCleanupRef.current?.();
    screenCleanupRef.current = null;
    micCleanupRef.current?.();
    micCleanupRef.current = null;
    managerRef.current?.close();
    managerRef.current = null;
    playbackCursorRef.current = 0;
  }

  function sendTypedMessage() {
    if (!typedInput.trim() || !managerRef.current) return;
    managerRef.current.sendText(typedInput.trim());
    setTranscript((current) => [
      ...current,
      {
        id: `typed-${Date.now()}`,
        role: "user",
        text: typedInput.trim(),
        meta: "typed",
      },
    ]);
    setTypedInput("");
  }

  async function createScreenShareHandle(): Promise<ScreenShareHandle> {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });

    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is unavailable for screen capture.");
    }
    const drawContext = context;

    let interval: number | null = null;

    function captureFrame() {
      if (video.videoWidth === 0 || video.videoHeight === 0) return;

      const width = 1280;
      const scale = width / video.videoWidth;
      canvas.width = width;
      canvas.height = Math.max(720, Math.round(video.videoHeight * scale));
      drawContext.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.72).split(",")[1] ?? null;
    }

    const stop = () => {
      if (interval != null) {
        window.clearInterval(interval);
        interval = null;
      }
      stream.getTracks().forEach((track) => track.stop());
    };

    stream.getVideoTracks()[0]?.addEventListener("ended", stop, { once: true });

    return {
      captureFrame() {
        return captureFrame() ?? null;
      },
      startStreaming(manager) {
        const initialFrame = captureFrame();
        if (initialFrame) {
          manager.sendVideoFrame(initialFrame);
        }

        interval = window.setInterval(() => {
          const frame = captureFrame();
          if (frame) {
            manager.sendVideoFrame(frame);
          }
        }, 1000);
      },
      stop,
    };
  }

  async function startMicrophone(manager: LiveSessionManager, stream: MediaStream) {
    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;

    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (event) => {
      if (!managerRef.current || snapshotRef.current.state === "speaking") {
        return;
      }

      const input = event.inputBuffer.getChannelData(0);
      const pcm16 = downsampleToPcm16(input, audioContext.sampleRate, 16000);
      if (pcm16.byteLength === 0) return;
      manager.sendAudioChunk(uint8ArrayToBase64(new Uint8Array(pcm16.buffer)));
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

    micCleanupRef.current = () => {
      manager.sendAudioStreamEnd();
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      audioContext.close().catch(() => undefined);
      audioContextRef.current = null;
    };
  }

  function enqueueAssistantAudio(bytes: Uint8Array) {
    const audioContext =
      audioContextRef.current ??
      new AudioContext({
        sampleRate: 24000,
      });
    audioContextRef.current = audioContext;

    const samples = pcm16ToFloat32(bytes);
    const buffer = audioContext.createBuffer(1, samples.length, 24000);
    buffer.copyToChannel(samples, 0);

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);

    const startAt = Math.max(audioContext.currentTime, playbackCursorRef.current);
    source.start(startAt);
    playbackCursorRef.current = startAt + buffer.duration;
  }

  return (
    <main className="min-h-screen text-white">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="border border-[var(--border)] px-6 py-5">
          <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--foreground-muted)]">
            Verity live
          </p>
          <h1 className="mt-1 text-[15px] font-medium text-[var(--foreground)]">
            Live page analysis workspace
          </h1>
          <p className="mt-1 max-w-3xl text-[11px] leading-5 text-[var(--foreground-muted)]">
            Transcript first. Setup and transport details stay collapsed until needed.
          </p>

          <div className="mt-5 flex flex-col gap-3 border border-[var(--border)] bg-[rgba(6,17,18,0.45)] p-4">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={startSession}
                disabled={starting || snapshot.isConnected}
                tone="accent"
              >
                <Screen size={14} aria-hidden="true" />
                <Microphone size={14} aria-hidden="true" />
                {starting
                  ? "Starting session..."
                  : snapshot.isConnected
                    ? "Voice session live"
                    : "Share screen and start voice"}
              </Button>
              <Button
                type="button"
                onClick={stopSession}
                disabled={!snapshot.isConnected}
                tone="neutral"
              >
                <Stop size={14} aria-hidden="true" />
                Stop session
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusButton label="State" value={snapshot.state} icon={<Information size={12} aria-hidden="true" />} />
              <StatusButton
                label="Key"
                value={liveConfig?.hasServerKey ? "ephemeral ready" : "missing server key"}
                icon={<Screen size={12} aria-hidden="true" />}
              />
              <StatusButton
                label="Resume"
                value={snapshot.resumeHandle ? "available" : "none"}
                icon={<Settings size={12} aria-hidden="true" />}
              />
            </div>
          </div>
        </header>

        <section className="mt-4 grid flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-h-[72vh] flex-col border border-[var(--border)]">
            <div className="grid grid-cols-[1fr_auto] items-end gap-3 border-b border-[var(--border)] px-4 py-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--foreground-muted)]">
                  Transcript
                </p>
                <p className="mt-1 text-[11px] leading-5 text-[var(--foreground-muted)]">
                  Live turns stay in view while controls remain secondary.
                </p>
              </div>
              <div className="font-mono text-[11px] text-[var(--foreground-muted)]">
                {transcript.length +
                  Number(Boolean(snapshot.partialAssistantTranscript || snapshot.partialUserTranscript))}{" "}
                entries
              </div>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
              {transcript.map((entry) => (
                <TranscriptEntryView key={entry.id} entry={entry} />
              ))}

              {snapshot.partialUserTranscript.trim() ? (
                <TranscriptEntryView
                  entry={{
                    id: "live-user",
                    role: "user",
                    text: snapshot.partialUserTranscript,
                    meta: "live mic",
                  }}
                />
              ) : null}

              {snapshot.partialAssistantTranscript.trim() ? (
                <TranscriptEntryView
                  entry={{
                    id: "live-assistant",
                    role: "assistant",
                    text: snapshot.partialAssistantTranscript,
                    meta: "live response",
                  }}
                />
              ) : null}
            </div>

            <details
              className="border-t border-[var(--border)] px-4 py-3"
              open={composeOpen}
              onToggle={(event) => setComposeOpen(event.currentTarget.open)}
            >
              <summary className="flex cursor-pointer items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--foreground-muted)]">
                    Typed message
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--foreground-muted)]">
                    Use only when voice is not enough.
                  </p>
                </div>
                <Button type="button" tone="ghost">
                  {composeOpen ? (
                    <ChevronUp size={14} aria-hidden="true" />
                  ) : (
                    <ChevronDown size={14} aria-hidden="true" />
                  )}
                  {composeOpen ? "Hide" : "Show"}
                </Button>
              </summary>
              <div className="mt-3 border border-[var(--border)] bg-[rgba(6,17,18,0.35)] p-3">
                <textarea
                  value={typedInput}
                  onChange={(event) => setTypedInput(event.target.value)}
                  placeholder="Optional typed message while the voice session is live"
                  className="min-h-24 w-full resize-none border-0 bg-transparent text-[12px] leading-6 text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]"
                />
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
                  <span className="text-[11px] text-[var(--foreground-muted)]">Typed input is optional.</span>
                  <Button
                    type="button"
                    onClick={sendTypedMessage}
                    disabled={!snapshot.isConnected || !typedInput.trim()}
                    tone="accent-soft"
                  >
                    <SendAlt size={14} aria-hidden="true" />
                    Send
                  </Button>
                </div>
              </div>
              {snapshot.lastError ? (
                <p className="mt-3 text-[11px] text-[#d29c9c]">{snapshot.lastError}</p>
              ) : null}
            </details>
          </div>

          <aside className="flex flex-col gap-3">
            <details
              className="border border-[var(--border)] bg-[rgba(6,17,18,0.28)] px-4 py-3"
              open={setupOpen}
              onToggle={(event) => setSetupOpen(event.currentTarget.open)}
            >
              <summary className="flex cursor-pointer items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--foreground-muted)]">
                    Session setup
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--foreground-muted)]">
                    Optional page hints and startup steps.
                  </p>
                </div>
                <Button type="button" tone="ghost">
                  {setupOpen ? (
                    <ChevronUp size={14} aria-hidden="true" />
                  ) : (
                    <ChevronDown size={14} aria-hidden="true" />
                  )}
                  {setupOpen ? "Hide" : "Show"}
                </Button>
              </summary>

              <div className="mt-4 space-y-4">
                <div className="space-y-3">
                  <input
                    value={pageTitle}
                    onChange={(event) => setPageTitle(event.target.value)}
                    placeholder="Optional page title"
                    className={inputClassName}
                  />
                  <input
                    value={pageUrl}
                    onChange={(event) => setPageUrl(event.target.value)}
                    placeholder="Optional page URL"
                    className={inputClassName}
                  />
                </div>

                <div className="border border-[var(--border)] bg-[rgba(6,17,18,0.35)] p-3">
                  <ol className="space-y-2 text-[12px] leading-6 text-[var(--foreground-muted)]">
                    <li>1. Start the live session.</li>
                    <li>2. Pick a tab or screen.</li>
                    <li>3. Allow microphone access.</li>
                    <li>4. Speak while Verity watches the page.</li>
                  </ol>
                </div>
              </div>
            </details>

            <details
              className="border border-[var(--border)] bg-[rgba(6,17,18,0.28)] px-4 py-3"
              open={detailsOpen}
              onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
            >
              <summary className="flex cursor-pointer items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--foreground-muted)]">
                    Runtime details
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--foreground-muted)]">
                    Model, transport, and stream state.
                  </p>
                </div>
                <Button type="button" tone="ghost">
                  {detailsOpen ? (
                    <ChevronUp size={14} aria-hidden="true" />
                  ) : (
                    <ChevronDown size={14} aria-hidden="true" />
                  )}
                  {detailsOpen ? "Hide" : "Show"}
                </Button>
              </summary>

              <div className="mt-4 flex flex-wrap gap-2">
                <Pill label={liveConfig?.live.model ?? "live config unavailable"} />
                <Pill label="audio modality" />
                <Pill label="1 FPS screen frames" />
                <Pill label="sendRealtimeInput" />
              </div>
            </details>
          </aside>
        </section>
      </div>
    </main>
  );
}

function formatStartSessionError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "Screen share or microphone permission was dismissed or denied. Allow both prompts, then try again.";
    }

    if (error.name === "NotFoundError") {
      return "No usable screen or microphone source was found for the live session.";
    }

    return error.message || "Failed to start the live session.";
  }

  return error instanceof Error ? error.message : "Failed to start the live session.";
}

function TranscriptEntryView({ entry }: { entry: TranscriptEntry }) {
  const tone =
    entry.role === "user"
      ? "mr-auto border-[#2d3f56] bg-[#182435] text-[#d9e3f2]"
      : "ml-auto border-[#33594e] bg-[#123329] text-[#e5f1ea]";

  const width = entry.role === "system" ? "max-w-xl" : "max-w-3xl";

  return (
    <article className={`${width} border px-4 py-3 ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.06em] opacity-80">
          <TranscriptRoleIcon role={entry.role} />
          {entry.role}
        </span>
        {entry.meta ? <span className="font-mono text-[11px] opacity-70">{entry.meta}</span> : null}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-[12px] leading-6">{entry.text}</p>
    </article>
  );
}

function buildPageContext(url: string, title: string): PageContext {
  return {
    ...INITIAL_PAGE,
    url: url.trim() || INITIAL_PAGE.url,
    title: title.trim() || INITIAL_PAGE.title,
    siteName: url ? tryGetHostname(url) : INITIAL_PAGE.siteName,
  };
}

async function hydratePageContext({
  apiOrigin,
  fallbackPage,
  screenshotBase64,
}: {
  apiOrigin: string;
  fallbackPage: PageContext;
  screenshotBase64: string | null;
}) {
  try {
    const response = await fetch(`${apiOrigin}/page/context`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        screenshotBase64,
        hintedUrl: fallbackPage.url !== INITIAL_PAGE.url ? fallbackPage.url : null,
        hintedTitle: fallbackPage.title !== INITIAL_PAGE.title ? fallbackPage.title : null,
        selectionText: fallbackPage.selectionText,
      }),
    });

    const body = (await response.json()) as PageHydrationHttpResponse;
    if (!response.ok || !body.ok) {
      return {
        page: fallbackPage,
        message: "Page text retrieval was unavailable, so Gemini Live will rely on screen share and voice only.",
        warnings: [body.ok ? "Page hydration failed." : body.error],
      };
    }

    return {
      page: body.page,
      message:
        body.source === "screen"
          ? `Retrieved page content from the screen-detected URL ${body.resolvedUrl}.`
          : `Retrieved page content from the provided URL ${body.resolvedUrl}.`,
      warnings: body.warnings,
    };
  } catch (error) {
    return {
      page: fallbackPage,
      message: "Page text retrieval was unavailable, so Gemini Live will rely on screen share and voice only.",
      warnings: [error instanceof Error ? error.message : "Page hydration failed."],
    };
  }
}

function downsampleToPcm16(input: Float32Array, inputRate: number, outputRate: number) {
  if (inputRate === outputRate) {
    return floatTo16BitPcm(input);
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.round(input.length / ratio);
  const result = new Int16Array(outputLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;

    for (let index = offsetBuffer; index < nextOffsetBuffer && index < input.length; index += 1) {
      accum += input[index];
      count += 1;
    }

    const sample = count > 0 ? accum / count : 0;
    result[offsetResult] =
      Math.max(-1, Math.min(1, sample)) < 0
        ? Math.max(-32768, Math.min(32767, sample * 0x8000))
        : Math.max(-32768, Math.min(32767, sample * 0x7fff));
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

function floatTo16BitPcm(input: Float32Array) {
  const result = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    result[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return result;
}

function uint8ArrayToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function pcm16ToFloat32(bytes: Uint8Array) {
  const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(bytes.byteLength / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = dataView.getInt16(index * 2, true) / 0x8000;
  }
  return samples;
}

function tryGetHostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return INITIAL_PAGE.siteName;
  }
}

function Pill({ label }: { label: string }) {
  return (
    <span className="inline-flex h-9 items-center rounded-[1px] border border-[var(--border)] bg-[rgba(8,28,29,0.55)] px-3 font-mono text-[11px] text-[var(--foreground-muted)]">
      {label}
    </span>
  );
}

const inputClassName =
  "w-full border border-[var(--border)] bg-[rgba(5,19,20,0.7)] px-3 py-3 text-[12px] text-[var(--foreground)] outline-none transition placeholder:text-[var(--foreground-muted)] focus:border-[var(--border-strong)]";

type ButtonTone = "accent" | "accent-soft" | "neutral" | "ghost";

function Button({
  tone,
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone: ButtonTone;
}) {
  return (
    <button
      {...props}
      className={`${buttonClassName(tone)} ${className}`.trim()}
    >
      {children}
    </button>
  );
}

function StatusButton({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <Button type="button" tone="ghost" className="cursor-default">
      <span className="text-[var(--foreground-muted)]">{icon}</span>
      <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--foreground-muted)]">
        {label}
      </span>
      <span className="font-mono text-[11px] text-[var(--foreground)]">{value}</span>
    </Button>
  );
}

function buttonClassName(tone: ButtonTone) {
  const base =
    "inline-flex h-9 items-center justify-center gap-2 rounded-[1px] border px-3 text-[11px] font-normal tracking-[0.01em] transition-colors disabled:cursor-not-allowed disabled:opacity-45";

  if (tone === "accent") {
    return `${base} border-[var(--border-strong)] bg-[rgba(65,96,93,0.16)] text-[var(--foreground)] hover:border-[var(--accent)]`;
  }

  if (tone === "accent-soft") {
    return `${base} border-[var(--border)] bg-[rgba(8,28,29,0.55)] text-[var(--foreground)] hover:border-[var(--border-strong)]`;
  }

  if (tone === "ghost") {
    return `${base} border-[var(--border)] bg-[rgba(8,28,29,0.55)] text-[var(--foreground)] hover:border-[var(--border-strong)]`;
  }

  return `${base} border-[var(--border)] bg-[rgba(8,28,29,0.55)] text-[var(--foreground)] hover:border-[var(--border-strong)]`;
}

function TranscriptRoleIcon({ role }: { role: TranscriptEntry["role"] }) {
  if (role === "user") {
    return <Microphone size={12} aria-hidden="true" />;
  }

  if (role === "assistant") {
    return <Information size={12} aria-hidden="true" />;
  }

  return <Settings size={12} aria-hidden="true" />;
}
