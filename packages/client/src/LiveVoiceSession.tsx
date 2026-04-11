"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Microphone,
  Screen,
  SendAlt,
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
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
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
            "Session connected.",
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

  const isConnected = snapshot.isConnected;
  const isIdle = !isConnected && !starting;

  return (
    <main className="flex h-screen flex-col overflow-hidden text-[var(--foreground)]">
      {/* ── Idle state: centered hero ── */}
      {isIdle && transcript.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6">
          {/* Verity wordmark */}
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-muted)]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 3C7.03 3 3 7.03 3 12s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm0 16.5c-4.14 0-7.5-3.36-7.5-7.5S7.86 4.5 12 4.5s7.5 3.36 7.5 7.5-3.36 7.5-7.5 7.5z" fill="var(--accent)" opacity="0.5" />
                <circle cx="12" cy="12" r="3" fill="var(--accent)" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold tracking-tight">Verity</h1>
            <p className="max-w-[260px] text-center text-[13px] leading-relaxed text-[var(--foreground-secondary)]">
              Share your screen, speak naturally, and get real-time analysis of what you are browsing.
            </p>
          </div>

          {/* Primary CTA */}
          <button
            type="button"
            onClick={startSession}
            disabled={starting || !liveConfig?.hasServerKey}
            className="group flex h-12 cursor-pointer items-center gap-3 rounded-full bg-[var(--accent)] px-6 text-[14px] font-medium text-[var(--background)] transition-all duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Screen size={18} aria-hidden="true" />
            <Microphone size={18} aria-hidden="true" />
            Start live session
          </button>

          {/* Subtle status */}
          <div className="flex items-center gap-2 text-[12px] text-[var(--foreground-muted)]">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${liveConfig?.hasServerKey ? "bg-[var(--success)]" : "bg-[var(--error)]"}`} />
            {liveConfig?.hasServerKey ? "Ready to connect" : "Server key unavailable"}
          </div>
        </div>
      )}

      {/* ── Active / has-transcript state ── */}
      {(!isIdle || transcript.length > 0) && (
        <>
          {/* Top bar */}
          <header className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent-muted)]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" fill="var(--accent)" />
                </svg>
              </div>
              <span className="text-[13px] font-medium">Verity</span>
              {isConnected && (
                <span className="flex items-center gap-1.5 rounded-full bg-[var(--success-muted)] px-2.5 py-1 text-[11px] font-medium text-[var(--success)]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--success)]" />
                  Live
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!isConnected && (
                <button
                  type="button"
                  onClick={startSession}
                  disabled={starting}
                  className="flex h-8 cursor-pointer items-center gap-2 rounded-full bg-[var(--accent)] px-4 text-[12px] font-medium text-[var(--background)] transition-all duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Screen size={14} aria-hidden="true" />
                  {starting ? "Starting..." : "Start"}
                </button>
              )}
              {isConnected && (
                <button
                  type="button"
                  onClick={stopSession}
                  className="flex h-8 cursor-pointer items-center gap-2 rounded-full border border-[var(--border-strong)] bg-transparent px-4 text-[12px] font-medium text-[var(--foreground-secondary)] transition-colors duration-200 hover:border-[var(--error)] hover:text-[var(--error)]"
                >
                  <Stop size={14} aria-hidden="true" />
                  End
                </button>
              )}
            </div>
          </header>

          {/* Transcript */}
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
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
                  meta: "speaking",
                }}
              />
            ) : null}

            {snapshot.partialAssistantTranscript.trim() ? (
              <TranscriptEntryView
                entry={{
                  id: "live-assistant",
                  role: "assistant",
                  text: snapshot.partialAssistantTranscript,
                  meta: "responding",
                }}
              />
            ) : null}
          </div>

          {/* Compose bar */}
          <div className="flex-shrink-0 border-t border-[var(--border)]">
            <details
              open={composeOpen}
              onToggle={(event) => setComposeOpen(event.currentTarget.open)}
            >
              <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5">
                <span className="text-[12px] text-[var(--foreground-muted)]">Type a message</span>
                {composeOpen ? (
                  <ChevronDown size={14} className="text-[var(--foreground-muted)]" aria-hidden="true" />
                ) : (
                  <ChevronUp size={14} className="text-[var(--foreground-muted)]" aria-hidden="true" />
                )}
              </summary>
              <div className="px-4 pb-4">
                <div className="flex items-end gap-2 rounded-xl border border-[var(--border)] bg-[var(--background-elevated)] p-2">
                  <textarea
                    value={typedInput}
                    onChange={(event) => setTypedInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        sendTypedMessage();
                      }
                    }}
                    placeholder="Type here while the session is live..."
                    rows={2}
                    className="min-h-0 flex-1 resize-none border-0 bg-transparent text-[13px] leading-relaxed text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]"
                  />
                  <button
                    type="button"
                    onClick={sendTypedMessage}
                    disabled={!snapshot.isConnected || !typedInput.trim()}
                    className="flex h-8 w-8 flex-shrink-0 cursor-pointer items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--background)] transition-all duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <SendAlt size={14} aria-hidden="true" />
                  </button>
                </div>
                {snapshot.lastError ? (
                  <p className="mt-2 text-[12px] text-[var(--error)]">{snapshot.lastError}</p>
                ) : null}
              </div>
            </details>
          </div>
        </>
      )}
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
  const isSystem = entry.role === "system";
  const isUser = entry.role === "user";

  const bubbleClass = isSystem
    ? "bg-[var(--background-surface)] text-[var(--foreground-secondary)] border border-[var(--border)]"
    : isUser
      ? "bg-[var(--user-bg)] text-[var(--user-text)] border border-[var(--user-border)]"
      : "bg-[var(--assistant-bg)] text-[var(--assistant-text)] border border-[var(--assistant-border)]";

  const alignment = isUser ? "ml-auto" : "mr-auto";

  return (
    <article className={`max-w-[88%] rounded-2xl px-4 py-3 ${bubbleClass} ${alignment}`}>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium capitalize opacity-70">
          {entry.role === "assistant" ? "verity" : entry.role}
        </span>
        {entry.meta ? (
          <span className="text-[10px] opacity-50">{entry.meta}</span>
        ) : null}
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed">{entry.text}</p>
    </article>
  );
}

function InlineTranscriptCard({ card }: { card: LiveInlineCard }) {
  const toneStyles =
    card.tone === "success"
      ? { accent: "var(--success)", accentMuted: "var(--success-muted)", text: "var(--success)" }
      : card.tone === "error"
        ? { accent: "var(--error)", accentMuted: "var(--error-muted)", text: "var(--error)" }
        : { accent: "var(--accent)", accentMuted: "var(--accent-muted)", text: "var(--accent-text)" };

  const progress =
    card.totalPages && card.totalPages > 0
      ? Math.max(6, Math.min(100, Math.round((card.pagesRead ?? 0) / card.totalPages * 100)))
      : null;

  return (
    <article
      className="mr-auto max-w-[88%] overflow-hidden rounded-2xl border border-[var(--border)]"
      style={{ background: `linear-gradient(135deg, ${toneStyles.accentMuted}, var(--background-surface))` }}
    >
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: toneStyles.text }}>
              {card.label}
            </p>
            <p className="mt-1 text-[13px] font-medium text-[var(--foreground)]">{card.title}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--foreground-secondary)]">{card.status}</p>
          </div>
          {card.metrics?.length ? (
            <div className="flex flex-wrap justify-end gap-1.5">
              {card.metrics.map((metric) => (
                <span
                  key={metric.label}
                  className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--background)] px-2 py-0.5 text-[10px] text-[var(--foreground-secondary)]"
                >
                  {metric.label}: {metric.value}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {card.query ? (
          <div className="mt-3 rounded-lg bg-[var(--background)] px-3 py-2">
            <p className="text-[12px] leading-relaxed text-[var(--foreground-secondary)]">{card.query}</p>
          </div>
        ) : null}
      </div>

      {progress !== null ? (
        <div className="h-1 bg-[var(--background)]">
          <div
            className="h-full transition-all duration-300"
            style={{ width: `${progress}%`, background: toneStyles.accent }}
          />
        </div>
      ) : null}

      {card.items?.length ? (
        <div className="flex flex-wrap gap-1.5 border-t border-[var(--border)] px-4 py-2.5">
          {card.items.map((item, index) => (
            <span
              key={`${card.id}-${index}-${item}`}
              className="inline-flex items-center rounded-full bg-[var(--background)] px-2.5 py-1 text-[11px] text-[var(--foreground-secondary)]"
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
