"use client";

import { Microphone, MicrophoneOff, Screen, Settings, Stop } from "@carbon/icons-react";

type SessionHeaderProps = {
  isConnected: boolean;
  starting: boolean;
  isMuted: boolean;
  onStart: () => void;
  onEnd: () => void;
  onToggleMute: () => void;
  onOpenSettings: () => void;
};

export function SessionHeader({
  isConnected,
  starting,
  isMuted,
  onStart,
  onEnd,
  onToggleMute,
  onOpenSettings,
}: SessionHeaderProps) {
  return (
    <header className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent-muted)]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="3" fill="var(--accent)" />
          </svg>
        </div>
        <span className="text-[13px] font-medium">Verity</span>
        {isConnected && (
          <span className="flex items-center gap-1.5 rounded-full bg-[var(--success-muted)] px-2.5 py-1 text-[11px] font-medium text-[var(--success)]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--success)]" />
            Live
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--foreground-secondary)] hover:bg-[var(--background-surface)] transition-colors"
        >
          <Settings size={18} />
        </button>
        {isConnected && (
          <button
            type="button"
            onClick={onToggleMute}
            title={isMuted ? "Unmute" : "Mute"}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
              isMuted ? "bg-[var(--error-muted)] text-[var(--error)]" : "text-[var(--foreground-secondary)] hover:bg-[var(--background-surface)]"
            }`}
          >
            {isMuted ? <MicrophoneOff size={18} /> : <Microphone size={18} />}
          </button>
        )}
        {isConnected && (
          <button
            type="button"
            onClick={onEnd}
            className="flex h-8 cursor-pointer items-center gap-2 rounded-full border border-[var(--border-strong)] bg-transparent px-4 text-[12px] font-medium text-[var(--foreground-secondary)] transition-colors duration-200 hover:border-[var(--error)] hover:text-[var(--error)]"
          >
            <Stop size={14} aria-hidden="true" />
            End
          </button>
        )}
      </div>
    </header>
  );
}
