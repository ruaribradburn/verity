"use client";

import { ChevronDown, ChevronUp, SendAlt, Stop } from "@carbon/icons-react";

type ComposeBarProps = {
  composeOpen: boolean;
  setComposeOpen: (o: boolean) => void;
  typedInput: string;
  setTypedInput: (t: string) => void;
  isConnected: boolean;
  onSend: () => void;
  onEnd: () => void;
  currentFrame: string | null;
  lastError: string | null;
};

export function ComposeBar({
  composeOpen,
  setComposeOpen,
  typedInput,
  setTypedInput,
  isConnected,
  onSend,
  onEnd,
  currentFrame,
  lastError,
}: ComposeBarProps) {
  return (
    <div className="flex-shrink-0 border-t border-[var(--border)] bg-[var(--background-surface)]">
      
      {/* ── Live Context Preview & Quick Controls ── */}
      {isConnected && (
        <div className="flex items-center justify-between gap-4 px-4 py-2 bg-[var(--background)]/50 border-b border-[var(--border)]">
          <div className="flex items-center gap-3 overflow-hidden">
             {currentFrame ? (
                <div className="relative h-10 w-16 flex-shrink-0 overflow-hidden rounded-md border border-[var(--border-strong)] shadow-sm">
                   <img 
                    src={`data:image/jpeg;base64,${currentFrame}`} 
                    alt="Live context" 
                    className="h-full w-full object-cover grayscale opacity-80"
                   />
                   <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
                </div>
             ) : (
                <div className="h-10 w-16 flex-shrink-0 rounded-md bg-[var(--background-elevated)] animate-pulse border border-[var(--border)]" />
             )}
             <div className="flex flex-col min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--accent)]">Vision Active</span>
                <span className="truncate text-[11px] text-[var(--foreground-secondary)] font-medium">Capturing screen context</span>
             </div>
          </div>

          <button
            onClick={onEnd}
            className="flex h-8 items-center gap-2 rounded-full border border-[var(--error)] bg-[var(--error-muted)] px-3 text-[10px] font-bold uppercase tracking-wider text-[var(--error)] hover:bg-[var(--error)] hover:text-white transition-all"
          >
            <Stop size={12} />
            End Session
          </button>
        </div>
      )}

      <details
        open={composeOpen}
        onToggle={(event) => setComposeOpen(event.currentTarget.open)}
      >
        <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5">
          <span className="text-[12px] text-[var(--foreground-muted)] font-medium">Type a message</span>
          {composeOpen ? (
            <ChevronDown size={14} className="text-[var(--foreground-muted)]" aria-hidden="true" />
          ) : (
            <ChevronUp size={14} className="text-[var(--foreground-muted)]" aria-hidden="true" />
          )}
        </summary>
        <div className="px-4 pb-4 animate-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-end gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--background)] p-2 focus-within:border-[var(--accent)] transition-colors">
            <textarea
              value={typedInput}
              onChange={(event) => setTypedInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onSend();
                }
              }}
              placeholder="Type your instructions here..."
              rows={2}
              className="min-h-0 flex-1 resize-none border-0 bg-transparent text-[13px] leading-relaxed text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]"
            />
            <button
              type="button"
              onClick={onSend}
              disabled={!isConnected || !typedInput.trim()}
              className="flex h-8 w-8 flex-shrink-0 cursor-pointer items-center justify-center rounded-lg bg-[var(--accent)] text-white transition-all duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <SendAlt size={16} aria-hidden="true" />
            </button>
          </div>
          {lastError ? <p className="mt-2 text-[10px] text-[var(--error)] font-medium">{lastError}</p> : null}
        </div>
      </details>
    </div>
  );
}
