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
import { attachMicrophoneToLiveSession } from "./microphone-stream";
import { createScreenShareHandle } from "./screen-share";

export type LiveVoiceSessionProps = {
  /** Base URL of `packages/api` (no trailing slash), e.g. http://127.0.0.1:3001 */
  apiOrigin: string;
  /** Prefill session setup (e.g. Chrome extension: active tab URL for reliable page hydration). */
  initialPageUrl?: string;
  initialPageTitle?: string;
};

type TranscriptEntry = {
  id: string;
  role: "system" | "user" | "assistant";
  text: string;
  meta?: string;
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

export function LiveVoiceSession({
  apiOrigin,
  initialPageUrl,
  initialPageTitle,
}: LiveVoiceSessionProps) {
  const base = apiOrigin.replace(/\/$/, "");

  const managerRef = useRef<LiveSessionManager | null>(null);
  const screenCleanupRef = useRef<(() => void) | null>(null);
  const micCleanupRef = useRef<(() => void) | null>(null);
  /** Dedicated 24 kHz context for assistant TTS — keep separate from mic capture graph. */
  const playbackAudioContextRef = useRef<AudioContext | null>(null);
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

  useEffect(() => {
    setPageUrl((prev) => {
      if (!initialPageUrl?.trim()) return prev;
      if (prev === "") return initialPageUrl.trim();
      return prev;
    });
    setPageTitle((prev) => {
      if (!initialPageTitle?.trim()) return prev;
      if (prev === "") return initialPageTitle.trim();
      return prev;
    });
  }, [initialPageUrl, initialPageTitle]);
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
      microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
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
    playbackAudioContextRef.current?.close().catch(() => undefined);
    playbackAudioContextRef.current = null;
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

  async function startMicrophone(manager: LiveSessionManager, stream: MediaStream) {
    micCleanupRef.current = await attachMicrophoneToLiveSession(manager, stream, {
      shouldSend: () => managerRef.current != null,
    });
  }

  function enqueueAssistantAudio(bytes: Uint8Array) {
    const audioContext =
      playbackAudioContextRef.current ??
      new AudioContext({
        sampleRate: 24000,
      });
    playbackAudioContextRef.current = audioContext;

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

          <div className="mt-5 flex flex-wrap items-center gap-3 border border-[var(--border)] px-4 py-3">
            <button
              type="button"
              onClick={startSession}
              disabled={starting || snapshot.isConnected}
              className={buttonClassName("selected")}
            >
              <Screen size={14} aria-hidden="true" />
              <Microphone size={14} aria-hidden="true" />
              {starting
                ? "Starting session..."
                : snapshot.isConnected
                  ? "Voice session live"
                  : "Share screen and start voice"}
            </button>
            <button
              type="button"
              onClick={stopSession}
              disabled={!snapshot.isConnected}
              className={buttonClassName("default")}
            >
              <Stop size={14} aria-hidden="true" />
              Stop session
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <ControlPill label="State" value={snapshot.state} />
              <ControlPill
                label="Key"
                value={liveConfig?.hasServerKey ? "ephemeral ready" : "missing server key"}
              />
              <ControlPill
                label="Resume"
                value={snapshot.resumeHandle ? "available" : "none"}
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
                <button type="button" className={buttonClassName("default", true)}>
                  {composeOpen ? (
                    <ChevronUp size={14} aria-hidden="true" />
                  ) : (
                    <ChevronDown size={14} aria-hidden="true" />
                  )}
                  {composeOpen ? "Hide" : "Show"}
                </button>
              </summary>
              <div className="mt-3 border border-[var(--border)] p-3">
                <textarea
                  value={typedInput}
                  onChange={(event) => setTypedInput(event.target.value)}
                  placeholder="Optional typed message while the voice session is live"
                  className="min-h-24 w-full resize-none border-0 bg-transparent text-[12px] leading-6 text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]"
                />
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
                  <span className="text-[11px] text-[var(--foreground-muted)]">Typed input is optional.</span>
                  <button
                    type="button"
                    onClick={sendTypedMessage}
                    disabled={!snapshot.isConnected || !typedInput.trim()}
                    className={buttonClassName("info")}
                  >
                    <SendAlt size={14} aria-hidden="true" />
                    Send
                  </button>
                </div>
              </div>
              {snapshot.lastError ? (
                <p className="mt-3 text-[11px] text-[#d29c9c]">{snapshot.lastError}</p>
              ) : null}
            </details>
          </div>

          <aside className="flex flex-col gap-3">
            <details
              className="border border-[var(--border)] px-4 py-3"
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
                <button type="button" className={buttonClassName("default", true)}>
                  {setupOpen ? (
                    <ChevronUp size={14} aria-hidden="true" />
                  ) : (
                    <ChevronDown size={14} aria-hidden="true" />
                  )}
                  {setupOpen ? "Hide" : "Show"}
                </button>
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

                <div className="border border-[var(--border)] p-3">
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
              className="border border-[var(--border)] px-4 py-3"
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
                <button type="button" className={buttonClassName("default", true)}>
                  {detailsOpen ? (
                    <ChevronUp size={14} aria-hidden="true" />
                  ) : (
                    <ChevronDown size={14} aria-hidden="true" />
                  )}
                  {detailsOpen ? "Hide" : "Show"}
                </button>
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
      ? "ml-auto border-[#41605d] text-[var(--foreground)]"
      : entry.role === "assistant"
        ? "mr-auto border-[var(--border-strong)] text-[var(--foreground)]"
        : "mx-auto border-[var(--border)] text-[var(--foreground-muted)]";

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
    <span className="border border-[var(--border)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--foreground-muted)]">
      {label}
    </span>
  );
}

const inputClassName =
  "w-full border border-[var(--border)] bg-transparent px-3 py-3 text-[12px] text-[var(--foreground)] outline-none transition placeholder:text-[var(--foreground-muted)] focus:border-[var(--border-strong)]";

function ControlPill({ label, value }: { label: string; value: string }) {
  const icon =
    label === "State" ? (
      <Information size={12} aria-hidden="true" />
    ) : label === "Key" ? (
      <Screen size={12} aria-hidden="true" />
    ) : (
      <Settings size={12} aria-hidden="true" />
    );

  return (
    <div className="inline-flex h-[26px] items-center gap-2 border border-[var(--border)] px-2.5 text-[11px]">
      <span className="text-[var(--foreground-muted)]">{icon}</span>
      <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--foreground-muted)]">
        {label}
      </span>
      <span className="font-mono text-[11px] text-[var(--foreground)]">{value}</span>
    </div>
  );
}

function buttonClassName(tone: "selected" | "info" | "default", compact = false) {
  const base =
    "inline-flex items-center justify-center gap-1.5 border text-[11px] font-normal tracking-[0.01em] transition disabled:cursor-not-allowed disabled:opacity-45";
  const sizing = compact ? "h-[26px] px-[10px]" : "h-[26px] px-[10px]";

  if (tone === "selected") {
    return `${base} ${sizing} border-[var(--border-strong)] text-[var(--foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)]`;
  }

  if (tone === "info") {
    return `${base} ${sizing} border-[var(--border-strong)] text-[var(--foreground-muted)] hover:border-[var(--foreground)] hover:text-[var(--foreground)]`;
  }

  return `${base} ${sizing} border-[var(--border)] text-[var(--foreground-muted)] hover:border-[var(--border-strong)] hover:text-[var(--foreground)]`;
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
