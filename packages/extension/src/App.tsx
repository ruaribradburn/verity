import { LiveVoiceSession } from "@packages/client";
import { useEffect, useState } from "react";
import { ResearchPanel } from "./components/ResearchPanel";

const apiOrigin =
  import.meta.env.VITE_API_ORIGIN?.replace(/\/$/, "") ?? "http://127.0.0.1:3001";

export default function App() {
  const [tabHint, setTabHint] = useState<{ url: string; title: string } | null>(null);

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

  return (
    <div className="flex flex-col gap-4 p-3">
      <ResearchPanel />
      <LiveVoiceSession
        apiOrigin={apiOrigin}
        initialPageUrl={tabHint?.url}
        initialPageTitle={tabHint?.title}
      />
    </div>
  );
}
