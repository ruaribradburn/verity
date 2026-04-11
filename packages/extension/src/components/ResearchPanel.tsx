import { useEffect, useRef, useState } from "react";
import type { PageContext } from "@packages/core";
import type {
  ResearchEvent,
  ResearchComplete,
} from "../research/types";

type ResearchStatus =
  | { phase: "idle" }
  | { phase: "running"; status: string; pagesRead: number; totalPages: number }
  | { phase: "done"; contexts: PageContext[]; stats: ResearchComplete["stats"] }
  | { phase: "error"; error: string };

export function ResearchPanel() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ResearchStatus>({ phase: "idle" });
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    function handleMessage(message: ResearchEvent) {
      switch (message.type) {
        case "research:progress":
          setStatus({
            phase: "running",
            status: message.status,
            pagesRead: message.pagesRead,
            totalPages: message.totalPages,
          });
          break;
        case "research:complete":
          setStatus({
            phase: "done",
            contexts: message.contexts,
            stats: message.stats,
          });
          break;
        case "research:error":
          setStatus({ phase: "error", error: message.error });
          break;
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  async function researchCurrentPage() {
    setStatus({ phase: "running", status: "Starting...", pagesRead: 0, totalPages: 0 });
    setExpandedIndex(null);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setStatus({ phase: "error", error: "No active tab found." });
      return;
    }

    chrome.runtime.sendMessage({
      type: "research:start",
      source: "page",
      tabId: tab.id,
    });
  }

  function researchQuery() {
    if (!query.trim()) return;
    setStatus({ phase: "running", status: "Starting...", pagesRead: 0, totalPages: 0 });
    setExpandedIndex(null);

    chrome.runtime.sendMessage({
      type: "research:start",
      source: "query",
      query: query.trim(),
    });
  }

  function cancelResearch() {
    chrome.runtime.sendMessage({ type: "research:cancel" });
    setStatus({ phase: "idle" });
  }

  const isRunning = status.phase === "running";

  return (
    <section className="rounded-[2rem] border border-black/8 bg-white p-5 shadow-[0_18px_60px_rgba(0,0,0,0.06)]">
      <p className="text-xs uppercase tracking-[0.34em] text-amber-700">
        Autonomous Research
      </p>

      <div className="mt-4 flex flex-col gap-3">
        <button
          type="button"
          onClick={researchCurrentPage}
          disabled={isRunning}
          className="w-full rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-amber-700 disabled:cursor-wait disabled:opacity-70"
        >
          {isRunning ? "Researching..." : "Research this page"}
        </button>

        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isRunning) researchQuery();
            }}
            placeholder="Or type a search query..."
            disabled={isRunning}
            className="flex-1 rounded-full border border-stone-300 bg-white px-4 py-2.5 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-amber-600 focus:ring-4 focus:ring-amber-200/60 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={researchQuery}
            disabled={isRunning || !query.trim()}
            className="rounded-full border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 transition hover:border-stone-900 hover:text-stone-900 disabled:opacity-40"
          >
            Search
          </button>
        </div>

        {isRunning && (
          <button
            type="button"
            onClick={cancelResearch}
            className="w-full rounded-full border border-red-300 bg-white px-5 py-2 text-sm font-medium text-red-700 transition hover:border-red-500"
          >
            Cancel
          </button>
        )}
      </div>

      {status.phase === "running" && (
        <div className="mt-4 rounded-xl bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-900">{status.status}</p>
          {status.totalPages > 0 && (
            <div className="mt-2">
              <div className="h-2 overflow-hidden rounded-full bg-amber-200">
                <div
                  className="h-full rounded-full bg-amber-600 transition-all"
                  style={{
                    width: `${Math.round((status.pagesRead / status.totalPages) * 100)}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-xs text-amber-700">
                {status.pagesRead} / {status.totalPages} pages read
              </p>
            </div>
          )}
        </div>
      )}

      {status.phase === "error" && (
        <div className="mt-4 rounded-xl bg-red-50 px-4 py-3">
          <p className="text-sm text-red-800">{status.error}</p>
        </div>
      )}

      {status.phase === "done" && (
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-stone-500">
              {status.stats.totalPages} pages collected
              {status.stats.failed > 0 && `, ${status.stats.failed} failed`}
              {" "}in {(status.stats.durationMs / 1000).toFixed(1)}s
            </p>
            <button
              type="button"
              onClick={() => setStatus({ phase: "idle" })}
              className="text-xs text-stone-500 underline hover:text-stone-900"
            >
              Clear
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {status.contexts.map((ctx, i) => (
              <div
                key={`${ctx.url}-${i}`}
                className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2"
              >
                <button
                  type="button"
                  onClick={() => setExpandedIndex(expandedIndex === i ? null : i)}
                  className="flex w-full items-start justify-between gap-2 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-stone-900">
                      {ctx.title ?? "Untitled"}
                    </p>
                    <p className="truncate text-xs text-stone-500">{ctx.siteName ?? ctx.url}</p>
                  </div>
                  <span className="mt-0.5 text-xs text-stone-400">
                    {expandedIndex === i ? "\u2212" : "+"}
                  </span>
                </button>

                {expandedIndex === i && (
                  <div className="mt-2 border-t border-stone-200 pt-2">
                    <p className="text-xs leading-5 text-stone-600">
                      {ctx.contentText.slice(0, 300)}
                      {ctx.contentText.length > 300 ? "..." : ""}
                    </p>
                    <p className="mt-1 text-xs text-stone-400 break-all">{ctx.url}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
