"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { LiveConfigHttpResponse, PageContext, PageHydrationHttpResponse } from "@packages/core";
import {
  createLiveSessionManager,
  type LiveSessionManager,
  type LiveSessionSnapshot,
} from "./live-session";
import { attachMicrophoneToLiveSession } from "./microphone-stream";
import { createScreenShareHandle } from "./screen-share";

// Import sub-components
import { SessionHeader } from "./components/LiveSession/SessionHeader";
import { SessionHero } from "./components/LiveSession/SessionHero";
import { TranscriptView } from "./components/LiveSession/TranscriptView";
import { SessionFooter } from "./components/LiveSession/SessionFooter";
import { SettingsOverlay } from "./components/LiveSession/SettingsOverlay";

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

export type TranscriptEntry = {
  id: string;
  role: "system" | "user" | "assistant";
  text: string;
  meta?: string;
};

export type LiveVoiceSessionProps = {
  apiOrigin: string;
  initialPageUrl?: string;
  initialPageTitle?: string;
  prepareLiveMediaCapture?: () => Promise<void>;
  onUserTurnComplete?: (text: string) => void;
  onToolCall?: (call: { id: string; name: string; args: Record<string, unknown> }, manager: LiveSessionManager) => void;
  onManagerReady?: (manager: LiveSessionManager) => void;
  inlineCard?: LiveInlineCard | null;
};

const INITIAL_PAGE: PageContext = {
  url: "Screen share session",
  title: "Live screen share",
  siteName: "live-share",
  publishedAt: null,
  selectionText: null,
  contentText: "Screen sharing is active. Verity should reason about context from live frames.",
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
  const [snapshot, setSnapshot] = useState<LiveSessionSnapshot>(snapshotRef.current);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [pageUrl, setPageUrl] = useState(initialPageUrl || "");
  const [pageTitle, setPageTitle] = useState(initialPageTitle || "");
  const [starting, setStarting] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef = useRef(isMuted);
  const [currentFrame, setCurrentFrame] = useState<string | null>(null);
  
  // Settings Overlay State
  const [localVoice, setLocalVoice] = useState("");
  const [localTemp, setLocalTemp] = useState(0.55);
  const [localAccent, setLocalAccent] = useState("");
  const [localStyle, setLocalStyle] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    setPageUrl(u => u || initialPageUrl || "");
    setPageTitle(t => t || initialPageTitle || "");
  }, [initialPageUrl, initialPageTitle]);

  useEffect(() => {
    void fetch(`${base}/live/config`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setLiveConfig(data);
        if (data?.live) {
          setLocalVoice(data.live.voiceName);
          setLocalTemp(data.live.temperature);
          setLocalAccent(data.live.speechStylePrompt || "");
          setLocalStyle(data.live.personalityPrompt || "");
        }
      })
      .catch(() => setLiveConfig(null));
  }, [base]);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  // Sync Voice Activity into Transcript Feed
  useEffect(() => {
    if (snapshot.turnCompleteCount === 0 || snapshot.turnCompleteCount === lastTurnCountRef.current) return;
    lastTurnCountRef.current = snapshot.turnCompleteCount;
    const fullUser = snapshot.partialUserTranscript.trim();
    const prev = prevUserTranscriptRef.current;
    const turnText = fullUser.startsWith(prev) ? fullUser.slice(prev.length).trim() : fullUser;
    prevUserTranscriptRef.current = fullUser;

    setTranscript(current => {
      const next = [...current];
      if (turnText) next.push({ id: `u-${snapshot.turnCompleteCount}`, role: "user", text: turnText, meta: "voice" });
      if (snapshot.partialAssistantTranscript.trim()) {
        next.push({ id: `a-${snapshot.turnCompleteCount}`, role: "assistant", text: snapshot.partialAssistantTranscript.trim(), meta: "live" });
      }
      return next;
    });
    if (turnText && onUserTurnComplete) onUserTurnComplete(turnText);
  }, [snapshot.partialAssistantTranscript, snapshot.partialUserTranscript, snapshot.turnCompleteCount, onUserTurnComplete]);

  async function startSession() {
    if (starting || snapshot.isConnected) return;
    setStarting(true);
    let micStream: MediaStream | null = null;
    try {
      await prepareLiveMediaCapture?.();
      const manager = createLiveSessionManager({
        apiOrigin: base,
        onSnapshot: (next) => { snapshotRef.current = next; setSnapshot(next); },
        onAudioChunk: enqueueAssistantAudio,
        onToolCall: (call) => onToolCall?.(call, managerRef.current!),
      });
      managerRef.current = manager;
      const screenShare = await createScreenShareHandle();
      screenCleanupRef.current = () => screenShare.stop();

      const hydrated = await hydratePageContext({
        apiOrigin: base,
        fallbackPage: { ...INITIAL_PAGE, url: pageUrl || INITIAL_PAGE.url, title: pageTitle || INITIAL_PAGE.title },
        screenshotBase64: screenShare.captureFrame(),
      });

      await manager.connect(hydrated.page);
      screenShare.startStreaming(manager, (frame) => {
        setCurrentFrame(frame);
      });
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      micCleanupRef.current = await attachMicrophoneToLiveSession(manager, micStream, {
        shouldSend: () => managerRef.current != null && !isMutedRef.current,
      });

      if (hydrated.page.url !== INITIAL_PAGE.url) setPageUrl(hydrated.page.url);
      if (hydrated.page.title) setPageTitle(hydrated.page.title);
      onManagerReady?.(manager);

      setTranscript(curr => [...curr, { id: `sys-${Date.now()}`, role: "system", text: `Connected. ${hydrated.message}`, meta: "connected" }]);
    } catch (error) {
       setTranscript(curr => [...curr, { id: `err-${Date.now()}`, role: "system", text: formatStartSessionError(error), meta: "error" }]);
       micStream?.getTracks().forEach(t => t.stop());
       stopSession();
    } finally { setStarting(false); }
  }

  function stopSession() {
    screenCleanupRef.current?.(); screenCleanupRef.current = null;
    micCleanupRef.current?.(); micCleanupRef.current = null;
    playbackAudioContextRef.current?.close().catch(() => {}); playbackAudioContextRef.current = null;
    managerRef.current?.close(); managerRef.current = null;
    playbackCursorRef.current = 0;
    setTranscript([]);
    setCurrentFrame(null);
    setSnapshot(prev => ({ ...prev, isConnected: false, state: "disconnected" }));
  }

  async function saveSettings() {
    setIsSaving(true);
    try {
      const resp = await fetch(`${base}/live/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceName: localVoice, temperature: localTemp, speechStylePrompt: localAccent, personalityPrompt: localStyle }),
      });
      const data = await resp.json();
      if (data.ok) { setLiveConfig(prev => prev ? { ...prev, live: data.settings } : prev); setSettingsOpen(false); }
    } catch (e) { console.error("Save failed:", e); } finally { setIsSaving(false); }
  }

  function enqueueAssistantAudio(bytes: Uint8Array) {
    const audioContext = playbackAudioContextRef.current ?? new AudioContext({ sampleRate: 24000 });
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
  const isIdle = !isConnected && !starting && transcript.length === 0;

  return (
    <main className="relative flex h-full flex-col overflow-hidden text-[var(--foreground)] bg-[var(--background)]">
      
      <SessionHeader 
        isConnected={isConnected}
        starting={starting}
        isMuted={isMuted}
        onStart={startSession}
        onEnd={stopSession}
        onToggleMute={() => setIsMuted(!isMuted)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {isIdle ? (
        <SessionHero starting={starting} hasServerKey={!!liveConfig?.hasServerKey} onStart={startSession} />
      ) : (
        <>
          <TranscriptView 
            transcript={transcript}
            inlineCard={inlineCard}
            partialUserTranscript={snapshot.partialUserTranscript}
            partialAssistantTranscript={snapshot.partialAssistantTranscript}
          />
          
          <SessionFooter 
            isConnected={isConnected}
            onEnd={stopSession}
            currentFrame={currentFrame}
          />
        </>
      )}

      {settingsOpen && (
        <SettingsOverlay 
          localVoice={localVoice} setLocalVoice={setLocalVoice}
          localTemp={localTemp} setLocalTemp={setLocalTemp}
          localAccent={localAccent} setLocalAccent={setLocalAccent}
          localStyle={localStyle} setLocalStyle={setLocalStyle}
          isSaving={isSaving} onSave={saveSettings} onClose={() => setSettingsOpen(false)}
        />
      )}

    </main>
  );
}

function formatStartSessionError(error: unknown) {
  return error instanceof Error ? error.message : "Failed to start the live session.";
}

function pcm16ToFloat32(bytes: Uint8Array) {
  const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(bytes.byteLength / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = dataView.getInt16(index * 2, true) / 0x8000;
  }
  return samples;
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        screenshotBase64,
        hintedUrl: fallbackPage.url,
        hintedTitle: fallbackPage.title,
      }),
    });
    const body = (await response.json()) as PageHydrationHttpResponse;
    if (!response.ok || !body.ok) {
      return {
        page: fallbackPage,
        message: "Page text retrieval unavailable.",
        warnings: [body.error || "Hydration failed"],
      };
    }
    return {
      page: body.page,
      message: `Context retrieved for ${body.resolvedUrl}.`,
      warnings: body.warnings,
    };
  } catch (error) {
    return {
      page: fallbackPage,
      message: "Network synchronization error.",
      warnings: [error instanceof Error ? error.message : "Failed"],
    };
  }
}
