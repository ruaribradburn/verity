import { LiveVoiceSession, type LiveInlineCard, type LiveSessionManager } from "@packages/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ensureLiveSessionMediaPolicy } from "./media-permissions";
import type { ResearchEvent, ResearchComplete } from "./research/types";

const apiOrigin =
  import.meta.env.VITE_API_ORIGIN?.replace(/\/$/, "") ?? "http://127.0.0.1:3001";

type VoiceResearchStatus =
  | { phase: "idle" }
  | {
      phase: "researching";
      query: string;
      pagesRead: number;
      totalPages: number;
      status: string;
      recentSources: string[];
    }
  | {
      phase: "done";
      query: string;
      pageCount: number;
      failed: number;
      durationMs: number;
      recentSources: string[];
    }
  | { phase: "error"; query: string; error: string };

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
        case "research:page-done":
          setVoiceResearch((prev) =>
            prev.phase === "researching"
              ? {
                  ...prev,
                  recentSources: dedupeRecentSources([
                    ...prev.recentSources,
                    formatResearchSourceLabel(message.context.title, message.context.siteName ?? message.context.url),
                  ]),
                }
              : prev,
          );
          break;

        case "research:complete":
          injectResearchResults(message);
          setVoiceResearch((prev) =>
            prev.phase === "researching"
              ? {
                  phase: "done",
                  query: prev.query,
                  pageCount: message.contexts.length,
                  failed: message.stats.failed,
                  durationMs: message.stats.durationMs,
                  recentSources: dedupeRecentSources(
                    message.contexts.map((ctx) =>
                      formatResearchSourceLabel(ctx.title, ctx.siteName ?? ctx.url),
                    ),
                  ),
                }
              : prev,
          );
          break;

        case "research:error":
          setVoiceResearch((prev) =>
            prev.phase === "researching"
              ? { phase: "error", query: prev.query, error: message.error }
              : { phase: "error", query: "", error: message.error },
          );
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
      recentSources: [],
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

  const researchInlineCard = buildResearchInlineCard(voiceResearch);

  return (
    <div className="flex flex-col p-3">
      <LiveVoiceSession
        apiOrigin={apiOrigin}
        initialPageUrl={tabHint?.url}
        initialPageTitle={tabHint?.title}
        prepareLiveMediaCapture={ensureLiveSessionMediaPolicy}
        onUserTurnComplete={handleUserTurnComplete}
        onManagerReady={handleManagerReady}
        inlineCard={researchInlineCard}
      />
    </div>
  );
}

function buildResearchInlineCard(status: VoiceResearchStatus): LiveInlineCard | null {
  if (status.phase === "idle") {
    return null;
  }

  if (status.phase === "researching") {
    return {
      id: "autonomous-research",
      label: "Agent activity",
      title: "Autonomous research running",
      status:
        status.totalPages > 0
          ? `${status.pagesRead}/${status.totalPages} pages reviewed. ${status.status}`
          : status.status,
      query: status.query,
      tone: "active",
      pagesRead: status.pagesRead,
      totalPages: status.totalPages,
      metrics: [
        { label: "mode", value: "research" },
        { label: "state", value: "running" },
      ],
      items: status.recentSources,
    };
  }

  if (status.phase === "done") {
    return {
      id: "autonomous-research",
      label: "Agent activity",
      title: "Research injected into the session",
      status: `${status.pageCount} sources collected in ${(status.durationMs / 1000).toFixed(1)}s${status.failed > 0 ? `, ${status.failed} failed` : ""}.`,
      query: status.query,
      tone: "success",
      metrics: [
        { label: "sources", value: String(status.pageCount) },
        { label: "state", value: "complete" },
      ],
      items: status.recentSources,
    };
  }

  return {
    id: "autonomous-research",
    label: "Agent activity",
    title: "Research failed",
    status: status.error,
    query: status.query || undefined,
    tone: "error",
    metrics: [
      { label: "mode", value: "research" },
      { label: "state", value: "error" },
    ],
  };
}

function dedupeRecentSources(items: string[]) {
  return [...new Set(items.filter(Boolean))].slice(-4);
}

function formatResearchSourceLabel(title: string | null | undefined, source: string) {
  const compactTitle = title?.trim() || "Untitled";
  return `${compactTitle} / ${source}`;
}
