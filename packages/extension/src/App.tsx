import { useEffect, useState } from "react";
import { LiveVoiceSession } from "@packages/client";

const apiOrigin =
  import.meta.env.VITE_API_ORIGIN?.replace(/\/$/, "") ?? "http://127.0.0.1:3001";

type MicState = "checking" | "granted" | "prompt" | "denied";

export default function App() {
  const [micState, setMicState] = useState<MicState>("checking");

  useEffect(() => {
    checkMicPermission();

    const listener = (message: { type?: string }) => {
      if (message.type === "verity:mic-granted") {
        setMicState("granted");
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  async function checkMicPermission() {
    try {
      const result = await navigator.permissions.query({ name: "microphone" as PermissionName });
      setMicState(result.state === "granted" ? "granted" : result.state === "denied" ? "denied" : "prompt");
      result.addEventListener("change", () => {
        setMicState(result.state === "granted" ? "granted" : result.state === "denied" ? "denied" : "prompt");
      });
    } catch {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        for (const track of stream.getTracks()) track.stop();
        setMicState("granted");
      } catch {
        setMicState("prompt");
      }
    }
  }

  function openPermissionsPage() {
    chrome.tabs.create({ url: chrome.runtime.getURL("permissions.html") });
  }

  if (micState === "checking") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f4efe6] text-stone-900">
        <p className="text-sm text-stone-500">Checking permissions...</p>
      </main>
    );
  }

  if (micState === "prompt" || micState === "denied") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f4efe6] px-4 text-stone-900">
        <div className="max-w-md space-y-5 rounded-[2rem] border border-black/8 bg-white p-6 text-center shadow-[0_18px_60px_rgba(0,0,0,0.06)]">
          <p className="text-xs uppercase tracking-[0.34em] text-amber-700">Verity</p>
          <h1 className="text-2xl font-semibold tracking-[-0.03em]">Microphone access needed</h1>
          <p className="text-sm leading-6 text-stone-600">
            {micState === "denied"
              ? "Microphone access was previously denied. Open the permissions page to re-grant it, or allow it in Chrome's site settings for this extension."
              : "Verity needs microphone access to run voice sessions. Chrome requires granting this from a full tab rather than the side panel."}
          </p>
          <button
            type="button"
            onClick={openPermissionsPage}
            className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-amber-700"
          >
            Open permissions page
          </button>
          <p className="text-xs text-stone-400">After granting access, this panel will update automatically.</p>
        </div>
      </main>
    );
  }

  return <LiveVoiceSession apiOrigin={apiOrigin} />;
}
