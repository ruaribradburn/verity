"use client";

type SessionFooterProps = {
  isConnected: boolean;
  currentFrame: string | null;
};

export function SessionFooter({
  isConnected,
  currentFrame,
}: SessionFooterProps) {
  if (!isConnected) return null;

  return (
    <div className="flex-shrink-0 border-t border-[var(--border)] bg-[var(--background-surface)] p-3">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] font-black uppercase tracking-widest text-[var(--foreground-muted)]">Live Screen Snapshot</span>
          <div className="flex items-center gap-1.5">
             <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)] animate-pulse" />
             <span className="text-[9px] font-bold text-[var(--success)] uppercase tracking-wider">Syncing Vision</span>
          </div>
        </div>
        
        <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-[var(--border-strong)] bg-black shadow-inner">
          {currentFrame ? (
            <img 
              src={`data:image/jpeg;base64,${currentFrame}`} 
              alt="Live frame" 
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] font-mono text-white/20">
              Awaiting First Frame...
            </div>
          )}
          <div className="absolute inset-0 pointer-events-none border border-white/5" />
        </div>
      </div>
    </div>
  );
}
