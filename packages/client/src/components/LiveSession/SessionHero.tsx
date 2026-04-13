"use client";

import { Microphone, Screen } from "@carbon/icons-react";

type SessionHeroProps = {
  starting: boolean;
  hasServerKey: boolean;
  onStart: () => void;
};

export function SessionHero({ starting, hasServerKey, onStart }: SessionHeroProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6">
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-muted)]">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 3C7.03 3 3 7.03 3 12s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm0 16.5c-4.14 0-7.5-3.36-7.5-7.5S7.86 4.5 12 4.5s7.5 3.36 7.5 7.5-3.36 7.5-7.5 7.5z"
              fill="var(--accent)"
              opacity="0.5"
            />
            <circle cx="12" cy="12" r="3" fill="var(--accent)" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold tracking-tight">Verity</h1>
        <p className="max-w-[260px] text-center text-[13px] leading-relaxed text-[var(--foreground-secondary)]">
          Share your screen, speak naturally, and get real-time analysis of what you are browsing.
        </p>
      </div>

      <button
        type="button"
        onClick={onStart}
        disabled={starting || !hasServerKey}
        className="group flex h-12 cursor-pointer items-center gap-3 rounded-full bg-[var(--accent)] px-6 text-[14px] font-medium text-[var(--background)] transition-all duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Screen size={18} aria-hidden="true" />
        <Microphone size={18} aria-hidden="true" />
        Start live session
      </button>

      <div className="flex items-center gap-2 text-[12px] text-[var(--foreground-muted)]">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${hasServerKey ? "bg-[var(--success)]" : "bg-[var(--error)]"}`}
        />
        {hasServerKey ? "Ready to connect" : "Server key unavailable"}
      </div>
    </div>
  );
}
