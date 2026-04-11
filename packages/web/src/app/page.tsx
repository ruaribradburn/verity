"use client";

import { useEffect, useRef, useState } from "react";
import {
  attachMicrophoneToLiveSession,
  createLiveSessionManager,
  requestLiveCaptureResources,
  type LiveSessionManager,
  type LiveSessionSnapshot,
} from "@packages/client";
import type {
  LiveConfigHttpResponse,
  PageContext,
  PageHydrationHttpResponse,
} from "@packages/core";

type TranscriptEntry = {
  id: string;
  role: "system" | "user" | "assistant";
  text: string;
  meta?: string;
};

const API_ORIGIN =
  process.env.NEXT_PUBLIC_API_ORIGIN?.replace(/\/$/, "") ?? "http://127.0.0.1:3001";

const INITIAL_PAGE: PageContext = {
  url: "Screen share session",
  title: "Live screen share",
  siteName: "live-share",
  publishedAt: null,
  selectionText: null,
  contentText:
    "Screen sharing is active. Verity should reason about the user's current browsing context from live frames and voice interaction.",
};

type BrowserWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

export default function Home() {
  const managerRef = useRef<LiveSessionManager | null>(null);
  const screenCleanupRef = useRef<(() => void) | null>(null);
  const micCleanupRef = useRef<(() => void) | null>(null);
  const playbackAudioContextRef = useRef<AudioContext | null>(null);
  const playbackCursorRef = useRef(0);
  const lastTurnCountRef = useRef(0);
  const snapshotRef = useRef<LiveSessionSnapshot>({
    state: "disconnected",
    partialUserTranscript: "",
    partialAssistantTranscript: "",
    lastCompletedUserTranscript: "",
    lastCompletedAssistantTranscript: "",
    resumeHandle: null,
    lastError: null,
    turnCompleteCount: 0,
    isConnected: false,
  });

  const [liveConfig, setLiveConfig] = useState<LiveConfigHttpResponse | null>(null);
  const [snapshot, setSnapshot] = useState<LiveSessionSnapshot>(snapshotRef.current);
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

  useEffect(() => {
    void fetch(`${API_ORIGIN}/live/config`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setLiveConfig(data))
      .catch(() => setLiveConfig(null));
  }, []);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    if (snapshot.turnCompleteCount === 0 || snapshot.turnCompleteCount === lastTurnCountRef.current) {
      return;
    }

    lastTurnCountRef.current = snapshot.turnCompleteCount;
    const completedUserTranscript = snapshot.lastCompletedUserTranscript.trim();
    const completedAssistantTranscript = snapshot.lastCompletedAssistantTranscript.trim();
    setTranscript((current) => {
      const next = [...current];
      if (completedUserTranscript) {
        next.push({
          id: `user-${snapshot.turnCompleteCount}`,
          role: "user",
          text: completedUserTranscript,
          meta: "voice",
        });
      }
      if (completedAssistantTranscript) {
        next.push({
          id: `assistant-${snapshot.turnCompleteCount}`,
          role: "assistant",
          text: completedAssistantTranscript,
          meta: "live response",
        });
      }
      return next;
    });
  }, [
    snapshot.lastCompletedAssistantTranscript,
    snapshot.lastCompletedUserTranscript,
    snapshot.turnCompleteCount,
  ]);

  useEffect(() => {
    return () => {
      stopSession();
    };
  }, []);

  async function startSession() {
    if (starting || snapshot.isConnected) return;

    setStarting(true);
    try {
      const manager = createLiveSessionManager({
        apiOrigin: API_ORIGIN,
        onSnapshot: (next) => {
          snapshotRef.current = next;
          setSnapshot(next);
        },
        onAudioChunk: enqueueAssistantAudio,
      });
      managerRef.current = manager;

      const { screenShare, microphoneStream } = await requestLiveCaptureResources();
      screenCleanupRef.current = () => screenShare.stop();

      const hydrated = await hydratePageContext({
        apiOrigin: API_ORIGIN,
        fallbackPage: buildPageContext(pageUrl, pageTitle),
        screenshotBase64: screenShare.captureFrame(),
      });

      await manager.connect(hydrated.page);
      screenShare.startStreaming(manager);
      await startMicrophone(manager, microphoneStream);

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
    const audioContext = playbackAudioContextRef.current ?? createPlaybackAudioContext();
    playbackAudioContextRef.current = audioContext;
    if (audioContext.state === "suspended") {
      void audioContext.resume().catch(() => undefined);
    }

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
    <main className="h-screen overflow-hidden bg-[#f4efe6] text-stone-900">
      <div className="mx-auto flex h-full max-w-5xl flex-col px-4 py-6 sm:px-6">
        <header className="rounded-[2rem] border border-black/8 bg-white px-6 py-6 shadow-[0_18px_60px_rgba(0,0,0,0.06)]">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.34em] text-amber-700">Verity live</p>
              <h1 className="text-4xl font-semibold tracking-[-0.05em]">Talk to the page you are viewing</h1>
              <p className="max-w-2xl text-sm leading-6 text-stone-600">
                Start one live Gemini session, share your screen, and let Verity reason about what
                it is seeing while you speak.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={startSession}
                disabled={starting || snapshot.isConnected}
                className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-amber-700 disabled:cursor-wait disabled:opacity-70"
              >
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
                className="rounded-full border border-stone-300 bg-white px-5 py-3 text-sm font-medium text-stone-700 transition hover:border-stone-900 hover:text-stone-900 disabled:opacity-40"
              >
                Stop session
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2 text-xs text-stone-600">
            <Pill label={`state: ${snapshot.state}`} />
            <Pill label={liveConfig?.hasServerKey ? "ephemeral token ready" : "missing Gemini server key"} />
            <Pill label={snapshot.resumeHandle ? "session resumable" : "no resume handle yet"} />
          </div>
        </header>

        <section className="mt-4 min-h-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-[2rem] border border-black/8 bg-white shadow-[0_18px_60px_rgba(0,0,0,0.06)]">
            <div className="border-b border-stone-200 px-5 py-4">
              <p className="text-xs uppercase tracking-[0.28em] text-amber-700">Transcript</p>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-5">
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

            <div className="border-t border-stone-200 px-4 py-4 sm:px-5">
              <div className="rounded-[1.5rem] border border-stone-200 bg-[#fbf9f4] p-3">
                <textarea
                  value={typedInput}
                  onChange={(event) => setTypedInput(event.target.value)}
                  placeholder="Optional typed message while the voice session is live"
                  className="min-h-24 w-full resize-none border-0 bg-transparent text-sm leading-6 text-stone-900 outline-none placeholder:text-stone-400"
                />
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-stone-200 pt-3">
                  <span className="text-xs text-stone-500">
                    Screen share is the primary context channel. Typed input is optional.
                  </span>
                  <button
                    type="button"
                    onClick={sendTypedMessage}
                    disabled={!snapshot.isConnected || !typedInput.trim()}
                    className="rounded-full bg-stone-950 px-4 py-2 text-sm font-medium text-stone-50 transition hover:bg-amber-700 disabled:opacity-40"
                  >
                    Send
                  </button>
                </div>
              </div>
              {snapshot.lastError ? <p className="mt-3 text-sm text-red-700">{snapshot.lastError}</p> : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function createPlaybackAudioContext() {
  const ctor = window.AudioContext ?? (window as BrowserWindow).webkitAudioContext;
  if (!ctor) {
    throw new Error("Web Audio playback is unavailable in this browser.");
  }
  return new ctor({ sampleRate: 24000 });
}

function formatStartSessionError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "Screen share or microphone permission was dismissed or denied. Allow both prompts, then try again.";
    }

    if (error.name === "NotFoundError") {
      return "No usable screen or microphone source was found for the live session.";
    }

    if (error.name === "NotReadableError") {
      return "Screen share or microphone capture could not start. Close any app already using those devices and check OS privacy settings.";
    }

    if (error.name === "SecurityError") {
      return "Live capture requires a secure context. Open Verity from localhost or HTTPS and try again.";
    }

    return error.message || "Failed to start the live session.";
  }

  return error instanceof Error ? error.message : "Failed to start the live session.";
}

function TranscriptEntryView({ entry }: { entry: TranscriptEntry }) {
  const [isOpen, setIsOpen] = useState(entry.role !== "system");
  const tone =
    entry.role === "user"
      ? "mr-auto bg-[#182435] text-[#d9e3f2]"
      : entry.role === "assistant"
        ? "ml-auto bg-[#123329] text-[#e5f1ea]"
        : "mr-auto bg-[#2a2412] text-[#f4edd4]";

  const width = entry.role === "system" ? "max-w-xl" : "max-w-3xl";

  return (
    <article className={`${width} rounded-[1.6rem] px-4 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.05)] ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.24em] opacity-75">
          {entry.role}
        </span>
        <div className="flex items-center gap-3">
          {entry.meta ? <span className="text-[11px] opacity-70">{entry.meta}</span> : null}
          {entry.role === "system" ? (
            <button
              type="button"
              onClick={() => setIsOpen((current) => !current)}
              className="text-[11px] font-semibold uppercase tracking-[0.2em] opacity-75"
              aria-expanded={isOpen}
            >
              {isOpen ? "Hide" : "Show"}
            </button>
          ) : null}
        </div>
      </div>
      {entry.role !== "system" || isOpen ? (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-7">{entry.text}</p>
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
    <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs text-stone-600">
      {label}
    </span>
  );
}

