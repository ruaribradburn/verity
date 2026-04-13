"use client";

type SettingsOverlayProps = {
  localVoice: string;
  setLocalVoice: (v: string) => void;
  localTemp: number;
  setLocalTemp: (t: number) => void;
  localAccent: string;
  setLocalAccent: (a: string) => void;
  localStyle: string;
  setLocalStyle: (s: string) => void;
  isSaving: boolean;
  onSave: () => void;
  onClose: () => void;
};

export function SettingsOverlay({
  localVoice,
  setLocalVoice,
  localTemp,
  setLocalTemp,
  localAccent,
  setLocalAccent,
  localStyle,
  setLocalStyle,
  isSaving,
  onSave,
  onClose,
}: SettingsOverlayProps) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[var(--background)] animate-in slide-in-from-bottom duration-300">
      <header className="flex h-14 items-center justify-between border-b border-[var(--border)] px-4">
        <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--foreground)]">Configuration</h2>
        <button
          onClick={onClose}
          className="text-xs font-bold text-[var(--foreground-muted)] uppercase hover:text-[var(--foreground)]"
        >
          Close
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--foreground-muted)]">
            Voice
          </label>
          <select
            value={localVoice}
            onChange={(e) => setLocalVoice(e.target.value)}
            className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--background-surface)] p-2 text-sm outline-none focus:border-[var(--accent)]"
          >
            {["Aoede", "Charon", "Erinome", "Fenrir", "Kore", "Puck"].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--foreground-muted)]">
              Temperature
            </label>
            <span className="text-[10px] font-mono text-[var(--accent)]">{localTemp.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="2"
            step="0.05"
            value={localTemp}
            onChange={(e) => setLocalTemp(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-[var(--background-surface)] rounded-full appearance-none accent-[var(--accent)]"
          />
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--foreground-muted)]">
            Accent & Style Prompt (.md)
          </label>
          <textarea
            value={localAccent}
            onChange={(e) => setLocalAccent(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--background-surface)] p-3 text-[12px] leading-relaxed outline-none focus:border-[var(--accent)]"
          />
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--foreground-muted)]">
            Personality Prompt (.md)
          </label>
          <textarea
            value={localStyle}
            onChange={(e) => setLocalStyle(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--background-surface)] p-3 text-[12px] leading-relaxed outline-none focus:border-[var(--accent)]"
          />
        </div>
      </div>

      <div className="border-t border-[var(--border)] p-4">
        <button
          onClick={onSave}
          disabled={isSaving}
          className="w-full rounded-xl bg-[var(--accent)] py-3 text-sm font-bold text-white hover:brightness-110 disabled:opacity-50"
        >
          {isSaving ? "Saving..." : "Apply & Save Settings"}
        </button>
      </div>
    </div>
  );
}
