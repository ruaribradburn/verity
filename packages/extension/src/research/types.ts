import type { PageContext } from "@packages/core";

export type ResearchStartFromPage = {
  type: "research:start";
  source: "page";
  tabId: number;
};

export type ResearchStartFromQuery = {
  type: "research:start";
  source: "query";
  query: string;
};

export type ResearchStartFromUrls = {
  type: "research:start";
  source: "urls";
  urls: string[];
};

export type ResearchCancel = {
  type: "research:cancel";
};

export type ResearchRequest =
  | ResearchStartFromPage
  | ResearchStartFromQuery
  | ResearchStartFromUrls
  | ResearchCancel;

export type ResearchProgress = {
  type: "research:progress";
  status: string;
  pagesRead: number;
  totalPages: number;
};

export type ResearchPageDone = {
  type: "research:page-done";
  context: PageContext;
  sourceQuery: string;
};

export type ResearchComplete = {
  type: "research:complete";
  contexts: PageContext[];
  stats: {
    totalPages: number;
    failed: number;
    durationMs: number;
  };
};

export type ResearchError = {
  type: "research:error";
  error: string;
};

export type ResearchEvent =
  | ResearchProgress
  | ResearchPageDone
  | ResearchComplete
  | ResearchError;

export type ResearchState = {
  active: boolean;
  pagesRead: number;
  totalPages: number;
  contexts: PageContext[];
  failed: number;
  startedAt: number;
};

export const RESEARCH_CONFIG = {
  maxConcurrentTabs: 5,
  perTabTimeoutMs: 15_000,
  totalTimeoutMs: 60_000,
  maxContentLength: 10_000,
  maxPagesToRead: 15,
  maxSerpResults: 8,
  keepAliveIntervalName: "verity-research-keepalive",
} as const;
