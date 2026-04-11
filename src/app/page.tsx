"use client";

import { useEffect, useRef, useState } from "react";
import type { LiveConfigHttpResponse, PageContext } from "@/core";
import {
  createLiveSessionManager,
  type LiveSessionManager,
  type LiveSessionSnapshot,
} from "@/lib/live-session";

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
    "Screen sharing is active. Verity should reason about the user’s current browsing context from live frames and voice interaction.",
};

export default function Home() {
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(true);

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

      const page = buildPageContext(pageUrl, pageTitle);
      await manager.connect(page);
      await startScreenShare(manager);
      await startMicrophone(manager);

      setTranscript((current) => [
        ...current,
        {
          id: `session-${Date.now()}`,
          role: "system",
          text: "Live session connected. Screen frames and microphone audio are now being streamed to Gemini Live.",
          meta: "connected",
        },
      ]);
    } catch (error) {
      setTranscript((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          role: "system",
          text: error instanceof Error ? error.message : "Failed to start the live session.",
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

  async function startScreenShare(manager: LiveSessionManager) {
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

    const interval = window.setInterval(() => {
      if (video.videoWidth === 0 || video.videoHeight === 0) return;

      const width = 1280;
      const scale = width / video.videoWidth;
      canvas.width = width;
      canvas.height = Math.max(720, Math.round(video.videoHeight * scale));
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const base64Jpeg = canvas.toDataURL("image/jpeg", 0.72).split(",")[1];
      manager.sendVideoFrame(base64Jpeg);
    }, 1000);

    const stop = () => {
      window.clearInterval(interval);
      stream.getTracks().forEach((track) => track.stop());
    };

    stream.getVideoTracks()[0]?.addEventListener("ended", stop, { once: true });
    screenCleanupRef.current = stop;
  }

  async function startMicrophone(manager: LiveSessionManager) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(142,240,231,0.12),transparent_28%),linear-gradient(180deg,#0b3438_0%,#072528_100%)] text-white">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="rounded-[1px] border border-white/12 bg-white/5 px-5 py-5 shadow-[0_24px_70px_rgba(0,0,0,0.22)] backdrop-blur-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.3em] text-white/60">Verity live</p>
              <h1 className="max-w-3xl text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
                Live page analysis, without the clutter
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-white/72">
                Share a screen, speak normally, and keep the transcript central while secondary
                controls stay tucked away until needed.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={startSession}
                disabled={starting || snapshot.isConnected}
                className="rounded-[1px] border border-white bg-white px-4 py-3 text-sm font-medium text-[#082c2f] transition hover:bg-[#dffefe] disabled:cursor-wait disabled:opacity-60"
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
                className="rounded-[1px] border border-white/18 bg-white/6 px-4 py-3 text-sm font-medium text-white transition hover:border-white/32 hover:bg-white/10 disabled:opacity-35"
              >
                Stop session
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Pill label={`state: ${snapshot.state}`} />
            <Pill label={liveConfig?.hasServerKey ? "ephemeral token ready" : "missing Gemini server key"} />
            <Pill label={snapshot.resumeHandle ? "session resumable" : "no resume handle yet"} />
          </div>
        </header>

        <section className="mt-4 grid flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-h-[72vh] flex-col rounded-[1px] border border-white/12 bg-white/6 shadow-[0_24px_70px_rgba(0,0,0,0.18)] backdrop-blur-sm">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-4 sm:px-5">
              <div>
                <p className="text-[11px] uppercase tracking-[0.28em] text-white/55">Transcript</p>
                <p className="mt-1 text-sm text-white/72">Live turns stay visible. Controls collapse below.</p>
              </div>
              <div className="font-mono text-[11px] text-white/55">
                {transcript.length + Number(Boolean(snapshot.partialAssistantTranscript || snapshot.partialUserTranscript))} entries
              </div>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5">
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
              className="border-t border-white/10 px-4 py-3 sm:px-5"
              open={composeOpen}
              onToggle={(event) => setComposeOpen(event.currentTarget.open)}
            >
              <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm text-white/78">
                <span>Typed message</span>
                <DisclosureIcon open={composeOpen} />
              </summary>
              <div className="mt-3 rounded-[1px] border border-white/10 bg-[#0a2f33] p-3">
                <textarea
                  value={typedInput}
                  onChange={(event) => setTypedInput(event.target.value)}
                  placeholder="Optional typed message while the voice session is live"
                  className="min-h-24 w-full resize-none border-0 bg-transparent text-sm leading-6 text-white outline-none placeholder:text-white/35"
                />
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
                  <span className="text-xs text-white/50">Use only when voice is not enough.</span>
                  <button
                    type="button"
                    onClick={sendTypedMessage}
                    disabled={!snapshot.isConnected || !typedInput.trim()}
                    className="rounded-[1px] border border-white bg-white px-3 py-2 text-sm font-medium text-[#082c2f] transition hover:bg-[#dffefe] disabled:opacity-35"
                  >
                    Send
                  </button>
                </div>
              </div>
              {snapshot.lastError ? <p className="mt-3 text-sm text-red-200">{snapshot.lastError}</p> : null}
            </details>
          </div>

          <aside className="flex flex-col gap-3">
            <details
              className="rounded-[1px] border border-white/12 bg-white/6 px-4 py-3 shadow-[0_20px_60px_rgba(0,0,0,0.16)] backdrop-blur-sm"
              open={setupOpen}
              onToggle={(event) => setSetupOpen(event.currentTarget.open)}
            >
              <summary className="flex cursor-pointer items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.28em] text-white/55">Session setup</p>
                  <p className="mt-1 text-sm text-white/72">Optional page hints and startup steps.</p>
                </div>
                <DisclosureIcon open={setupOpen} />
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

                <div className="rounded-[1px] border border-white/8 bg-[#0a2f33] p-3">
                  <ol className="space-y-2 text-sm leading-6 text-white/72">
                    <li>1. Start the live session.</li>
                    <li>2. Pick a tab or screen.</li>
                    <li>3. Allow microphone access.</li>
                    <li>4. Speak while Verity watches the page.</li>
                  </ol>
                </div>
              </div>
            </details>

            <details
              className="rounded-[1px] border border-white/12 bg-white/6 px-4 py-3 shadow-[0_20px_60px_rgba(0,0,0,0.16)] backdrop-blur-sm"
              open={detailsOpen}
              onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
            >
              <summary className="flex cursor-pointer items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.28em] text-white/55">Runtime details</p>
                  <p className="mt-1 text-sm text-white/72">Model, transport, and stream state.</p>
                </div>
                <DisclosureIcon open={detailsOpen} />
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

function TranscriptEntryView({ entry }: { entry: TranscriptEntry }) {
  const tone =
    entry.role === "user"
      ? "ml-auto border-white/16 bg-white text-[#082c2f]"
      : entry.role === "assistant"
        ? "mr-auto border-[#8ef0e7]/20 bg-[#0b3135] text-white"
        : "mx-auto border-white/10 bg-white/8 text-white/72";

  const width = entry.role === "system" ? "max-w-xl" : "max-w-3xl";

  return (
    <article className={`${width} rounded-[1px] border px-4 py-3 shadow-[0_12px_30px_rgba(0,0,0,0.12)] ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.24em] opacity-75">
          {entry.role}
        </span>
        {entry.meta ? <span className="font-mono text-[11px] opacity-70">{entry.meta}</span> : null}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{entry.text}</p>
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
    <span className="rounded-[1px] border border-white/12 bg-white/8 px-2.5 py-1.5 font-mono text-[11px] text-white/70">
      {label}
    </span>
  );
}

const inputClassName =
  "w-full rounded-[1px] border border-white/12 bg-[#0a2f33] px-3 py-3 text-sm text-white outline-none transition placeholder:text-white/32 focus:border-white/28 focus:bg-[#0c3438]";

function DisclosureIcon({ open }: { open: boolean }) {
  return (
    <span className="font-mono text-xs text-white/55" aria-hidden="true">
      {open ? "[-]" : "[+]"}
    </span>
  );
}
