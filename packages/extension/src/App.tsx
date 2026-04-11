import {
  LiveVoiceSession,
  type LiveActivityNotice,
  type LiveInlineCard,
  type LiveSessionManager,
} from "@packages/client";
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
  const autoTriggerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const proactivePageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastProactivePageUrlRef = useRef<string | null>(null);
  const pendingProactivePageRef = useRef<{ url: string; title: string } | null>(null);

  // Clean up auto-trigger timer on unmount
  useEffect(() => {
    return () => {
      if (autoTriggerTimerRef.current) clearTimeout(autoTriggerTimerRef.current);
      if (proactivePageTimerRef.current) clearTimeout(proactivePageTimerRef.current);
    };
  }, []);
  /** Capture what Gemini said in its immediate (grounding-only) response for cross-referencing. */
  const immediateResponseRef = useRef("");
  const pendingToolCallRef = useRef<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.tabs?.query) return;

    const refreshActiveTab = () => {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const t = tabs[0];
        const u = t?.url ?? "";
        if (!/^https?:\/\//i.test(u) || u.startsWith("chrome://") || u.startsWith("chrome-extension://")) {
          setTabHint(null);
          return;
        }
        setTabHint({ url: u, title: t?.title ?? "" });
      });
    };

    refreshActiveTab();

    const onActivated = () => refreshActiveTab();
    const onUpdated = (tabId: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (!tab.active || (!info.url && !info.title && info.status !== "complete")) {
        return;
      }
      refreshActiveTab();
    };

    chrome.tabs.onActivated?.addListener(onActivated);
    chrome.tabs.onUpdated?.addListener(onUpdated);
    window.addEventListener("focus", refreshActiveTab);

    return () => {
      chrome.tabs.onActivated?.removeListener(onActivated);
      chrome.tabs.onUpdated?.removeListener(onUpdated);
      window.removeEventListener("focus", refreshActiveTab);
    };
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
          flushPendingProactivePageResearch();
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
          flushPendingProactivePageResearch();
          break;
        }
      }
    }

    chrome.runtime.onMessage.addListener(handleResearchEvent);
    return () => chrome.runtime.onMessage.removeListener(handleResearchEvent);
  }, []);

  useEffect(() => {
    if (!tabHint) {
      return;
    }
    if (!managerRef.current?.getSnapshot().isConnected) {
      return;
    }

    const normalizedUrl = normalizeResearchUrl(tabHint.url);
    if (!shouldAutoResearchPage(tabHint)) {
      pendingProactivePageRef.current = null;
      return;
    }
    if (lastProactivePageUrlRef.current === normalizedUrl) {
      pendingProactivePageRef.current = null;
      return;
    }

    pendingProactivePageRef.current = tabHint;

    if (voiceResearchRef.current.phase === "researching") {
      return;
    }

    if (proactivePageTimerRef.current) {
      clearTimeout(proactivePageTimerRef.current);
    }

    proactivePageTimerRef.current = setTimeout(() => {
      proactivePageTimerRef.current = null;
      void flushPendingProactivePageResearch();
    }, 1200);
  }, [tabHint]);

  async function injectResearchResults(event: ResearchComplete) {
    const manager = managerRef.current;
    if (!manager || event.contexts.length === 0) return;
    const pendingToolCall = pendingToolCallRef.current;
    const shouldSpeakUpdate = pendingToolCall == null;

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
            `Now give the user a clear, unbiased analytical opinion based on ALL the evidence above. ` +
            `State what the evidence supports, what it contradicts, and what remains uncertain. ` +
            `Do not hedge excessively — give a direct, honest assessment while noting limits. ` +
            `Cite specific sources. Do not repeat raw text.`,
        ].join("\n");

        manager.sendContext(formatted);
        if (shouldSpeakUpdate) {
          manager.sendRuntimeDirective(
            buildResearchFollowupDirective({
              query: userQuery,
              sourceCount: event.contexts.length,
              confidence: briefing.metadata?.confidence ?? "medium",
            }),
          );
        }

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

    const fallbackPrompt =
      `[Verity Research â€” ${event.contexts.length} sources collected]\n\n` +
      crossRef +
      summary +
      `\n\nGive the user a clear, unbiased analytical opinion based on ALL sources above. ` +
      `State what the evidence supports, what it contradicts, and what remains uncertain. ` +
      `Be direct and honest. Cite sources by number. Do not repeat raw text.`;

    manager.sendContext(fallbackPrompt);
    if (shouldSpeakUpdate) {
      manager.sendRuntimeDirective(
        buildResearchFollowupDirective({
          query: userQuery,
          sourceCount: event.contexts.length,
          confidence: "mixed",
        }),
      );
    }

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

  async function flushPendingProactivePageResearch() {
    const pendingPage = pendingProactivePageRef.current;
    if (!pendingPage) {
      return;
    }
    if (!managerRef.current?.getSnapshot().isConnected) {
      return;
    }
    if (voiceResearchRef.current.phase === "researching") {
      return;
    }

    const normalizedUrl = normalizeResearchUrl(pendingPage.url);
    if (lastProactivePageUrlRef.current === normalizedUrl) {
      pendingProactivePageRef.current = null;
      return;
    }

    pendingProactivePageRef.current = null;
    lastProactivePageUrlRef.current = normalizedUrl;

    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id || !tab.url || normalizeResearchUrl(tab.url) !== normalizedUrl) {
      return;
    }

    console.log("[verity/ext] Proactively researching active page:", tab.url);
    setVoiceResearch({
      phase: "researching",
      query: pendingPage.title || pendingPage.url,
      pagesRead: 0,
      totalPages: 0,
      status: "Proactively analyzing current page...",
      recentSources: [],
    });
    chrome.runtime.sendMessage({
      type: "research:start",
      source: "page",
      tabId: tab.id,
    });
  }

  const handleUserTurnComplete = useCallback((text: string) => {
    // Voice-cancel: if the user says "stop" while research is running, cancel it
    if (voiceResearchRef.current.phase === "researching" && isCancelIntent(text)) {
      console.log("[verity/ext] User cancelled research via voice");
      pendingProactivePageRef.current = null;
      if (proactivePageTimerRef.current) {
        clearTimeout(proactivePageTimerRef.current);
        proactivePageTimerRef.current = null;
      }
      chrome.runtime.sendMessage({ type: "research:cancel" });
      const pending = pendingToolCallRef.current;
      if (pending && managerRef.current) {
        managerRef.current.sendToolResponse(pending.id, pending.name, {
          status: "cancelled",
          error: "Research cancelled by user.",
        });
        pendingToolCallRef.current = null;
      }
      setVoiceResearch({ phase: "idle" });
      return;
    }

    // Don't auto-trigger if research is already running (from tool call or previous auto-trigger)
    if (voiceResearchRef.current.phase === "researching") return;
    // Don't trigger for short utterances
    if (text.length < 20) return;

    // Extract URLs from user speech and auto-research them
    const spokenUrls = extractUrls(text);
    if (spokenUrls.length > 0) {
      console.log("[verity/ext] URLs detected in speech, auto-researching:", spokenUrls);
      if (autoTriggerTimerRef.current) clearTimeout(autoTriggerTimerRef.current);

      setVoiceResearch({
        phase: "researching",
        query: `Reading ${spokenUrls.length} link(s) from speech...`,
        pagesRead: 0,
        totalPages: spokenUrls.length,
        status: `Fetching ${spokenUrls.length} link(s)`,
        recentSources: [],
      });

      chrome.runtime.sendMessage({
        type: "research:start",
        source: "urls",
        urls: spokenUrls,
      });
      return;
    }

    // Only auto-trigger for analytical queries
    if (!isAnalyticalQuery(text)) return;

    // Give Gemini a brief window to call a tool itself. If it doesn't, auto-trigger immediately.
    if (autoTriggerTimerRef.current) clearTimeout(autoTriggerTimerRef.current);
    autoTriggerTimerRef.current = setTimeout(async () => {
      // Check again — Gemini might have called a tool in the meantime
      if (voiceResearchRef.current.phase !== "idle") return;

      // Detect if the user is referring to the current page/article on screen
      const refersToCurrentPage = isCurrentPageReference(text);

      if (refersToCurrentPage) {
        // Research the active tab directly — don't search for the user's words
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tab?.id && tab.url && /^https?:\/\//i.test(tab.url)) {
          lastProactivePageUrlRef.current = normalizeResearchUrl(tab.url);
          pendingProactivePageRef.current = null;
          console.log("[verity/ext] Auto-triggering PAGE research for active tab:", tab.url);
          setVoiceResearch({
            phase: "researching",
            query: tab.title ?? tab.url,
            pagesRead: 0,
            totalPages: 0,
            status: "Analyzing current page...",
            recentSources: [],
          });
          chrome.runtime.sendMessage({
            type: "research:start",
            source: "page",
            tabId: tab.id,
          });
          return;
        }
      }

      // Otherwise, use the user's question as a search query
      console.log("[verity/ext] Auto-triggering QUERY research:", text.slice(0, 80));
      setVoiceResearch({
        phase: "researching",
        query: text,
        pagesRead: 0,
        totalPages: 0,
        status: "Auto-triggered deep research...",
        recentSources: [],
      });

      chrome.runtime.sendMessage({
        type: "research:start",
        source: "query",
        query: text,
      });
    }, 500);
  }, []);

  const handleToolCall = useCallback(
    (call: { id: string; name: string; args: Record<string, unknown> }, manager: LiveSessionManager) => {
      // Cancel auto-trigger timer since Gemini called a tool explicitly
      if (autoTriggerTimerRef.current) {
        clearTimeout(autoTriggerTimerRef.current);
        autoTriggerTimerRef.current = null;
      }

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
        case "research_topic": {
          query = String(call.args.query ?? "");
          // If Gemini's query refers to "this article/page," research the active tab instead
          if (isCurrentPageReference(query)) {
            pendingToolCallRef.current = { id: call.id, name: call.name };
            void (async () => {
              const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
              if (tab?.id && tab.url && /^https?:\/\//i.test(tab.url)) {
                lastProactivePageUrlRef.current = normalizeResearchUrl(tab.url);
                pendingProactivePageRef.current = null;
                setVoiceResearch({
                  phase: "researching",
                  query: tab.title ?? tab.url,
                  pagesRead: 0,
                  totalPages: 0,
                  status: "Analyzing current page...",
                  recentSources: [],
                });
                chrome.runtime.sendMessage({ type: "research:start", source: "page", tabId: tab.id });
              } else {
                manager.sendToolResponse(call.id, call.name, { error: "No active web page found to research." });
                pendingToolCallRef.current = null;
              }
            })();
            return;
          }
          break;
        }
        case "fact_check_claim":
          query = `fact check: ${String(call.args.claim ?? "")}`;
          break;
        case "find_opposing_views":
          query = `${String(call.args.topic ?? "")} opposing view OR criticism OR counterargument`;
          break;
        case "research_entity":
          query = `${String(call.args.entity_name ?? "")} ${String(call.args.context ?? "")}`.trim();
          break;
        case "research_url": {
          const rawUrls = String(call.args.urls ?? "");
          const parsedUrls = rawUrls.split(",").map(u => u.trim()).filter(u => /^https?:\/\//i.test(u));
          if (parsedUrls.length === 0) {
            manager.sendToolResponse(call.id, call.name, { error: "No valid URLs provided." });
            return;
          }
          query = parsedUrls[0]; // Use first URL as the display query
          // Store URLs for the research:start message
          pendingToolCallRef.current = { id: call.id, name: call.name };
          setVoiceResearch({
            phase: "researching",
            query: `Reading ${parsedUrls.length} URL(s)...`,
            pagesRead: 0,
            totalPages: parsedUrls.length,
            status: `Fetching ${parsedUrls.length} link(s)`,
            recentSources: [],
          });
          chrome.runtime.sendMessage({
            type: "research:start",
            source: "urls",
            urls: parsedUrls,
          });
          return; // Early return since we handled everything including the message send
        }
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
  const researchActivityNotice = buildResearchActivityNotice(voiceResearch);

  return (
    <div className="flex flex-col p-3">
      <LiveVoiceSession
        apiOrigin={apiOrigin}
        initialPageUrl={tabHint?.url}
        initialPageTitle={tabHint?.title}
        prepareLiveMediaCapture={ensureLiveSessionMediaPolicy}
        onUserTurnComplete={handleUserTurnComplete}
        onToolCall={handleToolCall}
        onManagerReady={handleManagerReady}
        activityNotice={researchActivityNotice}
        inlineCard={researchInlineCard}
      />
    </div>
  );
}

/** Detect if a user utterance is analytical and should trigger research. */
function isAnalyticalQuery(text: string): boolean {
  const lower = text.toLowerCase();
  // Analytical intent signals
  const analyticalTerms = [
    "analyze", "analyse", "analysis",
    "what do you think", "is this true", "is that true", "is this accurate",
    "fact check", "fact-check", "verify", "check this",
    "what's missing", "what am i missing", "missing context",
    "bias", "biased", "framing", "misleading",
    "evidence", "source", "credib", "reliab",
    "opposing view", "other side", "counterargument", "counter-argument",
    "research", "investigate", "look into", "dig into",
    "what does the data say", "what do experts say",
    "is this real", "debunk", "claim",
    "article", "news", "report says", "according to",
    "who is", "what is the background", "tell me about",
    "compare", "contrast", "different perspective",
  ];
  return analyticalTerms.some((term) => lower.includes(term));
}

/** Detect if the user wants to cancel running research. */
function isCancelIntent(text: string): boolean {
  const lower = text.toLowerCase();
  const cancelTerms = [
    "stop research", "cancel research", "stop the research", "cancel the research",
    "stop looking", "stop searching", "never mind", "nevermind",
    "that's enough", "enough research", "stop digging",
    "cancel that", "abort", "stop that",
  ];
  return cancelTerms.some((term) => lower.includes(term));
}

/** Detect if the user is referring to the page/article currently on screen. */
function isCurrentPageReference(text: string): boolean {
  const lower = text.toLowerCase();
  const pageReferenceTerms = [
    "this article", "this page", "this news", "this story", "this post",
    "this blog", "this piece", "this report", "the article", "the page",
    "the news", "the story", "what i'm reading", "what i'm looking at",
    "what's on screen", "what's on the screen", "on screen",
    "what i've shown", "that i've shown", "i'm showing",
    "current page", "current article", "this site",
    "do some research on this", "research this", "analyze this", "analyse this",
    "check this article", "fact check this", "look at this",
  ];
  return pageReferenceTerms.some((term) => lower.includes(term));
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

/** Extract HTTP(S) URLs from text (spoken or typed). */
function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s,)"']+/gi;
  const matches = text.match(urlRegex);
  if (!matches) return [];
  return [...new Set(matches.map(u => u.replace(/[.)]+$/, "")))];
}

function buildResearchActivityNotice(status: VoiceResearchStatus): LiveActivityNotice | null {
  if (status.phase === "researching") {
    return {
      id: "autonomous-research-notice",
      tone: "active",
      text: status.query
        ? `Research in progress. Verity is gathering sources for "${status.query}".`
        : "Research in progress. Verity is gathering sources for the current page.",
    };
  }

  if (status.phase === "error") {
    return {
      id: "autonomous-research-notice",
      tone: "error",
      text: `Research failed: ${status.error}`,
    };
  }

  return null;
}

function buildResearchFollowupDirective({
  query,
  sourceCount,
  confidence,
}: {
  query: string;
  sourceCount: number;
  confidence: string;
}) {
  const queryLine = query.trim()
    ? `The user was asking about: "${query.trim()}".`
    : "The research relates to the user's current page and latest question.";

  return [
    `Research has completed. You have already been given the full trusted research context.`,
    queryLine,
    `You reviewed ${sourceCount} sources. Confidence level: ${confidence}.`,
    `Respond to the user now in a fresh spoken update.`,
    `Start by explicitly saying that you checked ${sourceCount} sources.`,
    `Then explain what the evidence supports, what it contradicts, and what remains uncertain.`,
    `Relate the findings directly to the current page and the user's concern.`,
    `Do not ask a follow-up question unless it is strictly necessary.`,
  ].join(" ");
}

function normalizeResearchUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function shouldAutoResearchPage(page: { url: string; title: string }): boolean {
  try {
    const parsed = new URL(page.url);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname.includes("google.") ||
      hostname.includes("bing.") ||
      hostname.includes("duckduckgo.") ||
      hostname.includes("youtube.com") ||
      hostname.includes("x.com") ||
      hostname.includes("twitter.com")
    ) {
      return false;
    }

    const path = parsed.pathname.toLowerCase();
    const title = page.title.trim().toLowerCase();
    const articleSignals = ["/article", "/news", "/story", "/stories", "/202", "/20", "/post", "/blog"];
    const titleSignals = [" - ", " | ", ":"];

    if (articleSignals.some((signal) => path.includes(signal))) {
      return true;
    }

    if (titleSignals.some((signal) => title.includes(signal)) && title.split(" ").length >= 5) {
      return true;
    }

    return path.split("/").filter(Boolean).length >= 2 && title.split(" ").length >= 6;
  } catch {
    return false;
  }
}
