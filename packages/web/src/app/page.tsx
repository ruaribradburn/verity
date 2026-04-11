"use client";

import { useEffect, useRef, useState } from "react";
import {
  attachMicrophoneToLiveSession,
  createLiveSessionManager,
  createScreenShareHandle,
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
  title: "Current browsing session",
  siteName: "live-share",
  publishedAt: null,
  selectionText: null,
  contentText:
    "Screen sharing is active. Verity should reason about the user's current browsing context from live frames and voice interaction.",
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
        apiOrigin: API_ORIGIN,
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
        apiOrigin: API_ORIGIN,
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
    <main className="min-h-screen bg-[#f4efe6] text-stone-900">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-6 sm:px-6">
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

        <section className="mt-4 grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="flex min-h-[70vh] flex-col rounded-[2rem] border border-black/8 bg-white shadow-[0_18px_60px_rgba(0,0,0,0.06)]">
            <div className="border-b border-stone-200 px-5 py-4">
              <p className="text-xs uppercase tracking-[0.28em] text-amber-700">Transcript</p>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-5">
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

          <aside className="flex flex-col gap-4 rounded-[2rem] border border-black/8 bg-white p-4 shadow-[0_18px_60px_rgba(0,0,0,0.06)]">
            <section className="space-y-3">
              <p className="text-xs uppercase tracking-[0.28em] text-amber-700">Page hint</p>
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
              <p className="text-xs leading-5 text-stone-500">
                These fields are optional hints. The real grounding path should come from the shared
                screen and voice stream.
              </p>
            </section>

            <section className="space-y-3 rounded-[1.5rem] bg-[#f7f1e6] p-4">
              <p className="text-xs uppercase tracking-[0.28em] text-amber-700">What happens</p>
              <ol className="space-y-2 text-sm leading-6 text-stone-700">
                <li>1. Click the primary button.</li>
                <li>2. Choose the browser tab or screen to share.</li>
                <li>3. Allow microphone access.</li>
                <li>4. Speak naturally while Verity watches the page.</li>
              </ol>
            </section>

            <section className="space-y-2 text-xs text-stone-500">
              <Pill label={liveConfig?.live.model ?? "live config unavailable"} />
              <Pill label="audio modality" />
              <Pill label="1 FPS screen frames" />
              <Pill label="sendRealtimeInput" />
            </section>
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
      ? "mr-auto bg-[#182435] text-[#d9e3f2]"
      : "ml-auto bg-[#123329] text-[#e5f1ea]";

  const width = entry.role === "system" ? "max-w-xl" : "max-w-3xl";

  return (
    <article className={`${width} rounded-[1.6rem] px-4 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.05)] ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.24em] opacity-75">
          {entry.role}
        </span>
        {entry.meta ? <span className="text-[11px] opacity-70">{entry.meta}</span> : null}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-7">{entry.text}</p>
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

const inputClassName =
  "w-full rounded-[1.1rem] border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-amber-600 focus:ring-4 focus:ring-amber-200/60";
