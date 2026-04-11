import type { PageContext } from "@packages/core";
import { extractPageContent } from "./extractor";
import { extractSerpResults } from "./serp-parser";
import { deriveSearchQueries } from "./search-queries";
import {
  RESEARCH_CONFIG,
  type ResearchState,
  type ResearchEvent,
} from "./types";

type BroadcastFn = (event: ResearchEvent) => void;

export async function runResearch(
  request:
    | { source: "page"; tabId: number }
    | { source: "query"; query: string },
  broadcast: BroadcastFn,
): Promise<void> {
  const state: ResearchState = {
    active: true,
    pagesRead: 0,
    totalPages: 0,
    contexts: [],
    failed: 0,
    startedAt: Date.now(),
  };

  await chrome.alarms.create(RESEARCH_CONFIG.keepAliveIntervalName, {
    periodInMinutes: 25 / 60,
  });

  try {
    let queries: string[];

    if (request.source === "page") {
      broadcast({
        type: "research:progress",
        status: "Reading current page...",
        pagesRead: 0,
        totalPages: 0,
      });

      const [seedResult] = await chrome.scripting.executeScript({
        target: { tabId: request.tabId },
        func: extractPageContent,
      });

      const seedContext = seedResult?.result as PageContext | undefined;
      if (!seedContext || !seedContext.contentText) {
        broadcast({
          type: "research:error",
          error: "Could not read content from the current page.",
        });
        return;
      }

      state.contexts.push(seedContext);
      state.pagesRead = 1;

      queries = deriveSearchQueries({
        title: seedContext.title,
        contentText: seedContext.contentText,
      });

      broadcast({
        type: "research:progress",
        status: `Derived ${queries.length} search queries`,
        pagesRead: 1,
        totalPages: 0,
      });
    } else {
      queries = [request.query];
    }

    if (queries.length === 0) {
      broadcast({
        type: "research:error",
        error: "Could not derive any search queries from the page.",
      });
      return;
    }

    broadcast({
      type: "research:progress",
      status: "Searching Google...",
      pagesRead: state.pagesRead,
      totalPages: 0,
    });

    const allResultUrls = await openSERPsAndExtractLinks(queries, state);

    const seen = new Set(state.contexts.map((c) => c.url));
    const uniqueUrls = allResultUrls.filter((r) => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });

    const toRead = uniqueUrls.slice(
      0,
      RESEARCH_CONFIG.maxPagesToRead - state.pagesRead,
    );
    state.totalPages = state.pagesRead + toRead.length;

    broadcast({
      type: "research:progress",
      status: `Reading ${toRead.length} pages...`,
      pagesRead: state.pagesRead,
      totalPages: state.totalPages,
    });

    await readPagesInParallel(toRead, state, broadcast);

    broadcast({
      type: "research:complete",
      contexts: state.contexts,
      stats: {
        totalPages: state.pagesRead,
        failed: state.failed,
        durationMs: Date.now() - state.startedAt,
      },
    });
  } catch (err) {
    broadcast({
      type: "research:error",
      error: err instanceof Error ? err.message : "Research failed unexpectedly.",
    });
  } finally {
    state.active = false;
    await chrome.alarms.clear(RESEARCH_CONFIG.keepAliveIntervalName);
  }
}

async function openSERPsAndExtractLinks(
  queries: string[],
  state: ResearchState,
): Promise<Array<{ url: string; title: string }>> {
  const allResults: Array<{ url: string; title: string }> = [];
  const serpTabs: Array<{ tabId: number; query: string }> = [];

  for (const query of queries) {
    if (!state.active || isTimedOut(state)) break;

    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    const tab = await chrome.tabs.create({ url: searchUrl, active: false });
    if (tab.id != null) {
      serpTabs.push({ tabId: tab.id, query });
    }
  }

  const tabIds = serpTabs.map((t) => t.tabId);
  if (tabIds.length > 0) {
    try {
      const groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, {
        title: "Verity Research",
        color: "orange",
        collapsed: true,
      });
    } catch {
      // non-fatal
    }
  }

  const serpPromises = serpTabs.map(({ tabId }) =>
    waitForTabAndExtract(tabId, extractSerpResults, state)
      .then((results) => {
        if (results) {
          for (const r of results) {
            allResults.push(r);
          }
        }
      })
      .catch(() => {
        state.failed += 1;
      })
      .finally(() => {
        chrome.tabs.remove(tabId).catch(() => {});
      }),
  );

  await Promise.all(serpPromises);
  return allResults;
}

async function readPagesInParallel(
  urls: Array<{ url: string; title: string }>,
  state: ResearchState,
  broadcast: BroadcastFn,
): Promise<void> {
  const batchSize = RESEARCH_CONFIG.maxConcurrentTabs;

  for (let i = 0; i < urls.length; i += batchSize) {
    if (!state.active || isTimedOut(state)) break;

    const batch = urls.slice(i, i + batchSize);
    const batchTabs: Array<{ tabId: number; url: string; sourceTitle: string }> = [];

    for (const { url, title } of batch) {
      if (!state.active || isTimedOut(state)) break;
      try {
        const tab = await chrome.tabs.create({ url, active: false });
        if (tab.id != null) {
          batchTabs.push({ tabId: tab.id, url, sourceTitle: title });
        }
      } catch {
        state.failed += 1;
      }
    }

    const batchTabIds = batchTabs.map((t) => t.tabId);
    if (batchTabIds.length > 0) {
      try {
        const groupId = await chrome.tabs.group({ tabIds: batchTabIds });
        await chrome.tabGroups.update(groupId, {
          title: "Verity Research",
          color: "orange",
          collapsed: true,
        });
      } catch {
        // non-fatal
      }
    }

    const extractPromises = batchTabs.map(({ tabId, sourceTitle }) =>
      waitForTabAndExtract(tabId, extractPageContent, state)
        .then((context) => {
          if (context && context.contentText) {
            state.contexts.push(context);
            state.pagesRead += 1;

            broadcast({
              type: "research:page-done",
              context,
              sourceQuery: sourceTitle,
            });

            broadcast({
              type: "research:progress",
              status: "Reading pages...",
              pagesRead: state.pagesRead,
              totalPages: state.totalPages,
            });
          } else {
            state.failed += 1;
          }
        })
        .catch(() => {
          state.failed += 1;
        })
        .finally(() => {
          chrome.tabs.remove(tabId).catch(() => {});
        }),
    );

    await Promise.all(extractPromises);
  }
}

function waitForTabAndExtract<T>(
  tabId: number,
  func: () => T,
  state: ResearchState,
): Promise<T | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(null);
    }, RESEARCH_CONFIG.perTabTimeoutMs);

    function listener(
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
    ) {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status !== "complete") return;

      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timeout);

      if (!state.active || isTimedOut(state)) {
        resolve(null);
        return;
      }

      chrome.scripting
        .executeScript({ target: { tabId }, func })
        .then(([result]) => resolve((result?.result as T) ?? null))
        .catch(() => resolve(null));
    }

    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);

        chrome.scripting
          .executeScript({ target: { tabId }, func })
          .then(([result]) => resolve((result?.result as T) ?? null))
          .catch(() => resolve(null));
      } else {
        chrome.tabs.onUpdated.addListener(listener);
      }
    }).catch(() => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

function isTimedOut(state: ResearchState): boolean {
  return Date.now() - state.startedAt > RESEARCH_CONFIG.totalTimeoutMs;
}
