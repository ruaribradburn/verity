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
  /** Capture what Gemini said in its immediate (grounding-only) response for cross-referencing. */
  const immediateResponseRef = useRef("");
  const pendingToolCallRef = useRef<{ id: string; name: string } | null>(null);

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
          // Snapshot what Gemini said before seeing the deep research.
          immediateResponseRef.current =
            managerRef.current?.getSnapshot().partialAssistantTranscript.trim() ?? "";
          void injectResearchResults(message);
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

        case "research:error": {
          // Send error response back to Gemini so it doesn't hang waiting for a tool response.
          const pending = pendingToolCallRef.current;
          if (pending && managerRef.current) {
            managerRef.current.sendToolResponse(pending.id, pending.name, {
              status: "error",
              error: message.error,
            });
            pendingToolCallRef.current = null;
          }
          setVoiceResearch((prev) =>
            prev.phase === "researching"
              ? { phase: "error", query: prev.query, error: message.error }
              : { phase: "error", query: "", error: message.error },
          );
          break;
        }
      }
    }

    chrome.runtime.onMessage.addListener(handleResearchEvent);
    return () => chrome.runtime.onMessage.removeListener(handleResearchEvent);
  }, []);

  async function injectResearchResults(event: ResearchComplete) {
    const manager = managerRef.current;
    if (!manager || event.contexts.length === 0) return;

    const priorResponse = immediateResponseRef.current;
    const userQuery =
      voiceResearchRef.current.phase === "researching"
        ? voiceResearchRef.current.query
        : voiceResearchRef.current.phase === "done"
          ? voiceResearchRef.current.query
          : "";

    // Build cross-reference preamble when we have Gemini's immediate response.
    const crossRef = priorResponse
      ? `[Your initial response (from Google Search grounding) said:]\n"${priorResponse.slice(0, 600)}"\n\n` +
        `The deep research below may confirm, contradict, or add nuance to what you already said. ` +
        `Cross-reference the two: correct anything inaccurate, highlight new information, ` +
        `and note where the deep sources agree or disagree with your initial answer.\n\n`
      : "";

    try {
      // Try the full orchestrated pipeline
      const response = await fetch(`${apiOrigin}/analyze/full`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pages: event.contexts,
          userPrompt: userQuery,
          priorResponse: priorResponse || undefined,
          mode: "analyst",
        }),
      });

      const result = await response.json();

      if (result.ok && result.briefing) {
        const briefing = result.briefing;
        const formatted = [
          `[Verity Analysis — ${event.contexts.length} sources, ${result.agents?.length ?? 3} agents]`,
          "",
          crossRef,
          `**Summary:** ${briefing.summary}`,
          "",
          `**Framing & Bias:** ${briefing.framingAndBias}`,
          "",
          `**Evidence & Credibility:** ${briefing.evidenceAndCredibility}`,
          "",
          `**Key Entities:** ${briefing.entitiesAndRelationships}`,
          "",
          `**Missing Context:** ${briefing.missingContextAndOpposing}`,
          "",
          `**What to Read Next:** ${briefing.whatToReadNext}`,
          "",
          `Confidence: ${briefing.metadata?.confidence ?? "medium"}. ` +
            `Synthesize this into a follow-up that adds to or corrects your initial response. ` +
            `Cite specific findings. Do not repeat raw text.`,
        ].join("\n");

        manager.sendContext(formatted);

        // Send tool response back to Gemini so it knows research is complete
        const pending = pendingToolCallRef.current;
        if (pending && manager) {
          manager.sendToolResponse(pending.id, pending.name, {
            status: "complete",
            sources_found: event.contexts.length,
            summary: briefing.summary.slice(0, 500),
          });
          pendingToolCallRef.current = null;
        }
        return;
      }
    } catch {
      // Fall through to fallback
    }

    // Fallback: inject raw page snippets with cross-reference
    const summary = event.contexts
      .map((ctx, i) => {
        const source = ctx.siteName ?? tryHostname(ctx.url);
        const snippet = ctx.contentText.slice(0, 800);
        return `[Source ${i + 1}: ${ctx.title ?? "Untitled"} — ${source}]\n${snippet}`;
      })
      .join("\n\n");

    manager.sendContext(
      `[Verity Research — ${event.contexts.length} sources collected]\n\n` +
        crossRef +
        summary +
        `\n\nSynthesize these sources into a follow-up. If your initial response was accurate, confirm and deepen it. ` +
        `If these sources contradict something you said, correct it explicitly. ` +
        `Cite sources by number. Do not repeat raw text.`,
    );

    const pending = pendingToolCallRef.current;
    if (pending && manager) {
      manager.sendToolResponse(pending.id, pending.name, {
        status: "complete",
        sources_found: event.contexts.length,
        summary: `Found ${event.contexts.length} sources.`,
      });
      pendingToolCallRef.current = null;
    }
  }

  const handleToolCall = useCallback(
    (call: { id: string; name: string; args: Record<string, unknown> }, manager: LiveSessionManager) => {
      // Don't stack concurrent research
      if (voiceResearchRef.current.phase === "researching") {
        manager.sendToolResponse(call.id, call.name, {
          error: "Research is already in progress. Please wait for the current research to complete.",
        });
        return;
      }

      // Build search query based on which function Gemini called
      let query: string;
      switch (call.name) {
        case "research_topic":
          query = String(call.args.query ?? "");
          break;
        case "fact_check_claim":
          query = `fact check: ${String(call.args.claim ?? "")}`;
          break;
        case "find_opposing_views":
          query = `${String(call.args.topic ?? "")} opposing view OR criticism OR counterargument`;
          break;
        case "research_entity":
          query = `${String(call.args.entity_name ?? "")} ${String(call.args.context ?? "")}`.trim();
          break;
        default:
          manager.sendToolResponse(call.id, call.name, { error: `Unknown function: ${call.name}` });
          return;
      }

      if (!query.trim()) {
        manager.sendToolResponse(call.id, call.name, { error: "Empty query — cannot research." });
        return;
      }

      // Store the call info so we can send the response when research completes
      pendingToolCallRef.current = { id: call.id, name: call.name };

      setVoiceResearch({
        phase: "researching",
        query,
        pagesRead: 0,
        totalPages: 0,
        status: `Gemini requested: ${call.name}`,
        recentSources: [],
      });

      chrome.runtime.sendMessage({
        type: "research:start",
        source: "query",
        query,
      });
    },
    [],
  );

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
        onToolCall={handleToolCall}
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

function tryHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
