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
  /**
   * Run before screen share + microphone (e.g. Chrome extension: enforce `chrome.permissions`
   * and mic site policy). Should throw if the user must fix settings before capture APIs run.
   */
  prepareLiveMediaCapture?: () => Promise<void>;
  /** Called when a user voice turn completes with the transcribed text. */
  onUserTurnComplete?: (text: string) => void;
  /** Called when Gemini requests a function call (research tools). Host handles execution and calls manager.sendToolResponse(). */
  onToolCall?: (call: { id: string; name: string; args: Record<string, unknown> }, manager: LiveSessionManager) => void;
  /** Called with the live session manager once connected, so the host can inject context. */
  onManagerReady?: (manager: LiveSessionManager) => void;
  /** Optional inline agent-style card rendered directly inside the transcript flow. */
  inlineCard?: LiveInlineCard | null;
};

type TranscriptEntry = {
  id: string;
  role: "system" | "user" | "assistant";
  text: string;
  meta?: string;
};

export type LiveInlineCard = {
  id: string;
  label: string;
  title: string;
  status: string;
  query?: string;
  tone?: "active" | "success" | "error";
  pagesRead?: number;
  totalPages?: number;
  metrics?: Array<{ label: string; value: string }>;
  items?: string[];
};

const INITIAL_PAGE: PageContext = {
  url: "Screen share session",
  title: "Live screen share",
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
  prepareLiveMediaCapture,
  onUserTurnComplete,
  onToolCall,
  onManagerReady,
  inlineCard,
}: LiveVoiceSessionProps) {
  const base = apiOrigin.replace(/\/$/, "");

  const managerRef = useRef<LiveSessionManager | null>(null);
  const screenCleanupRef = useRef<(() => void) | null>(null);
  const micCleanupRef = useRef<(() => void) | null>(null);
  /** Dedicated 24 kHz context for assistant TTS — keep separate from mic capture graph. */
  const playbackAudioContextRef = useRef<AudioContext | null>(null);
  const playbackCursorRef = useRef(0);
  const lastTurnCountRef = useRef(0);
  const prevUserTranscriptRef = useRef("");
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
  const [composeOpen, setComposeOpen] = useState(false);

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
    const fullUserTranscript = snapshot.partialUserTranscript.trim();
    // Extract only the new portion of the user transcript for this turn.
    const prev = prevUserTranscriptRef.current;
    const turnText = fullUserTranscript.startsWith(prev)
      ? fullUserTranscript.slice(prev.length).trim()
      : fullUserTranscript;
    prevUserTranscriptRef.current = fullUserTranscript;

    setTranscript((current) => {
      const next = [...current];
      if (turnText) {
        next.push({
          id: `user-${snapshot.turnCompleteCount}`,
          role: "user",
          text: turnText,
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
    if (turnText && onUserTurnComplete) {
      onUserTurnComplete(turnText);
    }
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
      await prepareLiveMediaCapture?.();

      const manager = createLiveSessionManager({
        apiOrigin: base,
        onSnapshot: (next) => {
          snapshotRef.current = next;
          setSnapshot(next);
        },
        onAudioChunk: enqueueAssistantAudio,
        onToolCall: (call) => {
          if (onToolCall && managerRef.current) {
            onToolCall(call, managerRef.current);
          }
        },
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
      onManagerReady?.(manager);

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
    <main className="h-screen overflow-hidden text-white">
      <div className="mx-auto flex h-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="border border-[var(--border)] px-6 py-5">
          <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--foreground-muted)]">
            Verity live
          </p>
          <h1 className="mt-1 text-[15px] font-medium text-[var(--foreground)]">
            Live page analysis workspace
          </h1>
          <p className="mt-1 max-w-3xl text-[11px] leading-5 text-[var(--foreground-muted)]">
            Transcript first. Start the live session and keep the conversation in view.
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

        <section className="mt-4 min-h-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 flex-col overflow-hidden border border-[var(--border)]">
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

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
              {transcript.map((entry) => (
                <TranscriptEntryView key={entry.id} entry={entry} />
              ))}

              {inlineCard ? <InlineTranscriptCard key={inlineCard.id} card={inlineCard} /> : null}

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
  const [isOpen, setIsOpen] = useState(entry.role !== "system");
  const tone =
    entry.role === "user"
      ? "mr-auto border-[#2d3f56] bg-[#182435] text-[#d9e3f2]"
      : entry.role === "assistant"
        ? "ml-auto border-[#33594e] bg-[#123329] text-[#e5f1ea]"
        : "mr-auto border-[#4e4a35] bg-[#262112] text-[#f4edd4]";

  const width = entry.role === "system" ? "max-w-xl" : "max-w-3xl";

  return (
    <article className={`${width} border px-4 py-3 ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.06em] opacity-80">
          <TranscriptRoleIcon role={entry.role} />
          {entry.role}
        </span>
        <div className="flex items-center gap-3">
          {entry.meta ? <span className="font-mono text-[11px] opacity-70">{entry.meta}</span> : null}
          {entry.role === "system" ? (
            <button
              type="button"
              onClick={() => setIsOpen((current) => !current)}
              className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.06em] opacity-80"
              aria-expanded={isOpen}
            >
              {isOpen ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
              {isOpen ? "Hide" : "Show"}
            </button>
          ) : null}
        </div>
      </div>
      {entry.role !== "system" || isOpen ? (
        <p className="mt-2 whitespace-pre-wrap text-[12px] leading-6">{entry.text}</p>
      ) : null}
    </article>
  );
}

function InlineTranscriptCard({ card }: { card: LiveInlineCard }) {
  const tone =
    card.tone === "success"
      ? {
          border: "border-[#33594e]",
          bg: "bg-[linear-gradient(180deg,rgba(12,38,32,0.96),rgba(9,25,22,0.98))]",
          label: "text-[#8db7a6]",
          title: "text-[#e5f1ea]",
          body: "text-[#abc5ba]",
          track: "bg-[#163028]",
          fill: "bg-[#5e8f7d]",
          item: "border-[#26453c] bg-[rgba(15,42,35,0.7)] text-[#c7dcd4]",
        }
      : card.tone === "error"
        ? {
            border: "border-[#6f4740]",
            bg: "bg-[linear-gradient(180deg,rgba(40,20,18,0.96),rgba(27,12,11,0.98))]",
            label: "text-[#c8958c]",
            title: "text-[#f0d8d2]",
            body: "text-[#d7afa8]",
            track: "bg-[#311816]",
            fill: "bg-[#a8675c]",
            item: "border-[#5d3934] bg-[rgba(45,21,19,0.7)] text-[#ebcec8]",
          }
        : {
            border: "border-[#4a5640]",
            bg: "bg-[linear-gradient(180deg,rgba(31,33,17,0.96),rgba(18,20,10,0.98))]",
            label: "text-[#b7b18b]",
            title: "text-[#f1eedf]",
            body: "text-[#c9c19f]",
            track: "bg-[#282613]",
            fill: "bg-[#b0a36a]",
            item: "border-[#59532d] bg-[rgba(33,31,15,0.72)] text-[#ece3b8]",
          };

  const progress =
    card.totalPages && card.totalPages > 0
      ? Math.max(6, Math.min(100, Math.round((card.pagesRead ?? 0) / card.totalPages * 100)))
      : null;

  return (
    <article
      className={`mr-auto max-w-3xl border px-4 py-4 shadow-[0_12px_32px_rgba(0,0,0,0.22)] ${tone.border} ${tone.bg}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className={`font-mono text-[10px] uppercase tracking-[0.14em] ${tone.label}`}>{card.label}</p>
          <h3 className={`mt-1 text-[13px] font-medium ${tone.title}`}>{card.title}</h3>
          <p className={`mt-1 text-[11px] leading-5 ${tone.body}`}>{card.status}</p>
        </div>
        {card.metrics?.length ? (
          <div className="flex flex-wrap justify-end gap-2">
            {card.metrics.map((metric) => (
              <span
                key={metric.label}
                className={`inline-flex h-8 items-center border px-2.5 font-mono text-[10px] ${tone.item}`}
              >
                {metric.label}: {metric.value}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {card.query ? (
        <div className={`mt-3 border px-3 py-2 ${tone.item}`}>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] opacity-70">Prompt</p>
          <p className="mt-1 text-[12px] leading-6">{card.query}</p>
        </div>
      ) : null}

      {progress !== null ? (
        <div className="mt-3">
          <div className={`h-1.5 overflow-hidden ${tone.track}`}>
            <div className={`h-full transition-all duration-300 ${tone.fill}`} style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : null}

      {card.items?.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {card.items.map((item, index) => (
            <span
              key={`${card.id}-${index}-${item}`}
              className={`inline-flex items-center border px-2.5 py-1.5 text-[11px] ${tone.item}`}
            >
              {item}
            </span>
          ))}
        </div>
      ) : null}
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
  if (fallbackPage.url === INITIAL_PAGE.url) {
    return {
      page: fallbackPage,
      message: "Page text retrieval was skipped because no page URL hint was available yet.",
      warnings: [],
    };
  }

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
