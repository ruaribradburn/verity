"use client";

import { LiveVoiceSession } from "@packages/client";

const API_ORIGIN =
  process.env.NEXT_PUBLIC_API_ORIGIN?.replace(/\/$/, "") ?? "http://127.0.0.1:3001";

export default function Home() {
  return (
    <div className="flex h-screen items-center justify-center bg-[#0a0a0a]">
      {/* Mock Sidepanel Container to match Extension proportions */}
      <div className="h-[90vh] w-[400px] overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--background)] shadow-2xl">
        <LiveVoiceSession 
          apiOrigin={API_ORIGIN}
          initialPageUrl="https://github.com/google-gemini/verity"
          initialPageTitle="Verity Project Root"
        />
      </div>
    </div>
  );
}
