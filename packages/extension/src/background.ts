import { runResearch } from "./research/orchestrator";
import { RESEARCH_CONFIG, type ResearchRequest, type ResearchEvent } from "./research/types";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RESEARCH_CONFIG.keepAliveIntervalName) {
    console.log("[verity/bg] Keepalive ping");
  }
});

let cancelResearch: (() => void) | null = null;

chrome.runtime.onMessage.addListener(
  (message: ResearchRequest, _sender, sendResponse) => {
    if (message.type === "research:cancel") {
      console.log("[verity/bg] Research cancelled by user");
      cancelResearch?.();
      cancelResearch = null;
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "research:start") {
      console.log("[verity/bg] Research request:", message.source, message.source === "query" ? message.query : `tab ${message.tabId}`);

      const broadcast = (event: ResearchEvent) => {
        console.log("[verity/bg]", event.type);
        chrome.runtime.sendMessage(event).catch(() => {});
      };

      const request =
        message.source === "page"
          ? { source: "page" as const, tabId: message.tabId }
          : { source: "query" as const, query: message.query };

      let aborted = false;
      cancelResearch = () => {
        aborted = true;
      };

      runResearch(request, broadcast)
        .catch((err) => {
          broadcast({
            type: "research:error",
            error: err instanceof Error ? err.message : "Research failed.",
          });
        })
        .finally(() => {
          cancelResearch = null;
        });

      sendResponse({ ok: true, started: true });
      return false;
    }

    return false;
  },
);
