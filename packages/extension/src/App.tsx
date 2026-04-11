import { LiveVoiceSession, type LiveSessionManager } from "@packages/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ResearchPanel } from "./components/ResearchPanel";
import { ensureLiveSessionMediaPolicy } from "./media-permissions";
import type { ResearchEvent, ResearchComplete } from "./research/types";

const apiOrigin =
  import.meta.env.VITE_API_ORIGIN?.replace(/\/$/, "") ?? "http://127.0.0.1:3001";

type VoiceResearchStatus =
  | { phase: "idle" }
  | { phase: "researching"; query: string; pagesRead: number; totalPages: number; status: string }
  | { phase: "done"; query: string; pageCount: number };

export default function App() {
  const [tabHint, setTabHint] = useState<{ url: string; title: string } | null>(null);
  const managerRef = useRef<LiveSessionManager | null>(null);
  const [voiceResearch, setVoiceResearch] = useState<VoiceResearchStatus>({ phase: "idle" });
  const voiceResearchRef = useRef(voiceResearch);
  voiceResearchRef.current = voiceResearch;

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.tabs?.query) return;
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const t = tabs[0];
      const u = t?.url ?? "";
      if (!/^https?:\/\//i.test(u) || u.startsWith("chrome://") || u.startsWith("chrome-extension://")) {
        return;
      }
      setTabHint({ url: u, title: t?.title ?? "" });
    });
  }, []);

  // Listen for research events from the background worker and feed results into the live session.
  useEffect(() => {
    function handleResearchEvent(message: ResearchEvent) {
      // Only handle events when voice-triggered research is active.
      if (voiceResearchRef.current.phase !== "researching") return;

      switch (message.type) {
        case "research:progress":
          setVoiceResearch((prev) =>
            prev.phase === "researching"
              ? { ...prev, pagesRead: message.pagesRead, totalPages: message.totalPages, status: message.status }
              : prev,
          );
          break;

        case "research:complete":
          injectResearchResults(message);
          setVoiceResearch((prev) =>
            prev.phase === "researching"
              ? { phase: "done", query: prev.query, pageCount: message.contexts.length }
              : prev,
          );
          // Auto-clear the "done" badge after a few seconds.
          setTimeout(() => {
            setVoiceResearch((prev) => (prev.phase === "done" ? { phase: "idle" } : prev));
          }, 5000);
          break;

        case "research:error":
          setVoiceResearch({ phase: "idle" });
          break;
      }
    }

    chrome.runtime.onMessage.addListener(handleResearchEvent);
    return () => chrome.runtime.onMessage.removeListener(handleResearchEvent);
  }, []);

  function injectResearchResults(event: ResearchComplete) {
    const manager = managerRef.current;
    if (!manager || event.contexts.length === 0) return;

    const summary = event.contexts
      .map((ctx, i) => {
        const source = ctx.siteName ?? new URL(ctx.url).hostname;
        const snippet = ctx.contentText.slice(0, 800);
        return `[Source ${i + 1}: ${ctx.title ?? "Untitled"} — ${source}]\n${snippet}`;
      })
      .join("\n\n");

    manager.sendContext(
      `[Verity Research — ${event.contexts.length} sources collected]\n\n${summary}\n\n` +
        `Use these sources to give a more grounded, evidence-aware response to the user's last question. ` +
        `Cite sources by number when relevant. Do not repeat the raw text back — synthesize.`,
    );
  }

  const handleUserTurnComplete = useCallback((text: string) => {
    // Don't trigger research if one is already running.
    if (voiceResearchRef.current.phase === "researching") return;
    // Only research substantial queries (not short acknowledgements).
    if (text.length < 15) return;

    setVoiceResearch({
      phase: "researching",
      query: text,
      pagesRead: 0,
      totalPages: 0,
      status: "Starting research...",
    });

    chrome.runtime.sendMessage({
      type: "research:start",
      source: "query",
      query: text,
    });
  }, []);

  const handleManagerReady = useCallback((manager: LiveSessionManager) => {
    managerRef.current = manager;
  }, []);

  return (
    <div className="flex flex-col gap-4 p-3">
      <ResearchPanel />

      {/* Voice-triggered research status indicator */}
      {voiceResearch.phase === "researching" && (
        <div className="rounded-xl border border-amber-700/30 bg-amber-950/40 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
            <p className="text-xs font-medium text-amber-300">Researching in background</p>
          </div>
          <p className="mt-1 text-[11px] text-amber-400/80 line-clamp-1">
            &ldquo;{voiceResearch.query}&rdquo;
          </p>
          {voiceResearch.totalPages > 0 && (
            <div className="mt-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-amber-900/50">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all duration-300"
                  style={{
                    width: `${Math.round((voiceResearch.pagesRead / voiceResearch.totalPages) * 100)}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-[10px] text-amber-500/70">
                {voiceResearch.pagesRead} / {voiceResearch.totalPages} pages &middot; {voiceResearch.status}
              </p>
            </div>
          )}
        </div>
      )}

      {voiceResearch.phase === "done" && (
        <div className="rounded-xl border border-emerald-700/30 bg-emerald-950/40 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500" />
            <p className="text-xs text-emerald-300">
              Research complete &middot; {voiceResearch.pageCount} sources injected into session
            </p>
          </div>
        </div>
      )}

      <LiveVoiceSession
        apiOrigin={apiOrigin}
        initialPageUrl={tabHint?.url}
        initialPageTitle={tabHint?.title}
        prepareLiveMediaCapture={ensureLiveSessionMediaPolicy}
        onUserTurnComplete={handleUserTurnComplete}
        onManagerReady={handleManagerReady}
      />
    </div>
  );
}
