import { useCallback, useEffect, useState } from "react";
import {
  checkAllPermissions,
  requestMissingPermissions,
  type PermissionItem,
  type PermissionStatus,
} from "../permissions-check";
import { openVerityPermissionsTab } from "../media-permissions";

interface Props {
  children: React.ReactNode;
}

/**
 * Wraps the main app. Only blocks if something is genuinely broken
 * (audioCapture disabled, mic explicitly denied). Normal "prompt" states pass through.
 */
export function PermissionsGate({ children }: Props) {
  const [status, setStatus] = useState<PermissionStatus | null>(null);

  const refresh = useCallback(async () => {
    const next = await checkAllPermissions();
    setStatus(next);
  }, []);

  useEffect(() => {
    refresh();

    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) return;
    const handler = (msg: { type?: string }) => {
      if (msg.type === "verity:mic-granted") {
        void refresh();
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, [refresh]);

  if (!status) return null;
  if (status.allGranted) return <>{children}</>;

  return <PermissionsPage status={status} onGrant={handleGrant} onRefresh={refresh} />;

  async function handleGrant() {
    if (!status) return;
    openVerityPermissionsTab();
  }
}

function PermissionsPage({
  status,
  onGrant,
  onRefresh,
}: {
  status: PermissionStatus;
  onGrant: () => void;
  onRefresh: () => void;
}) {
  const missing = status.items.filter((item) => !item.granted);
  const hasGrantable = missing.some((item) => item.grantable);
  const needsAudioCapture = missing.some((item) => item.id === "audioCapture");
  const micDenied = missing.some((item) => item.id === "microphone" && !item.grantable);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--background)] px-6 py-10">
      {/* Logo */}
      <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-muted)]">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3C7.03 3 3 7.03 3 12s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm0 16.5c-4.14 0-7.5-3.36-7.5-7.5S7.86 4.5 12 4.5s7.5 3.36 7.5 7.5-3.36 7.5-7.5 7.5z" fill="var(--accent)" opacity="0.5" />
          <circle cx="12" cy="12" r="3" fill="var(--accent)" />
        </svg>
      </div>

      <div className="w-full max-w-sm">
        <h1 className="text-center text-lg font-semibold tracking-tight text-[var(--foreground)]">
          Permissions needed
        </h1>
        <p className="mt-2 text-center text-[13px] leading-relaxed text-[var(--foreground-secondary)]">
          Verity needs a few things enabled before it can start.
        </p>

        <div className="mt-6 space-y-2">
          {missing.map((item) => (
            <PermissionRow key={item.id} item={item} />
          ))}
        </div>

        {needsAudioCapture && (
          <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--accent-muted)] px-4 py-3">
            <p className="text-[12px] font-medium text-[var(--accent-text)]">Enable audio recording</p>
            <ol className="mt-2 list-inside list-decimal space-y-1 text-[12px] leading-relaxed text-[var(--foreground-secondary)]">
              <li>Open <strong className="text-[var(--foreground)]">chrome://extensions</strong></li>
              <li>Find <strong className="text-[var(--foreground)]">Verity</strong> and click <strong className="text-[var(--foreground)]">Details</strong></li>
              <li>Toggle on <strong className="text-[var(--foreground)]">&ldquo;Record audio&rdquo;</strong></li>
              <li>Come back and tap <strong className="text-[var(--foreground)]">Refresh</strong></li>
            </ol>
          </div>
        )}

        {micDenied && (
          <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--error-muted)] px-4 py-3">
            <p className="text-[12px] font-medium text-[var(--error)]">Microphone blocked</p>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--foreground-secondary)]">
              Open <strong className="text-[var(--foreground)]">chrome://settings/content/microphone</strong>, remove Verity from the blocked list, then refresh.
            </p>
          </div>
        )}

        <div className="mt-6 flex gap-3">
          {hasGrantable && (
            <button
              type="button"
              onClick={onGrant}
              className="flex-1 cursor-pointer rounded-full bg-[var(--accent)] py-3 text-center text-[13px] font-medium text-[var(--background)] transition-all duration-200 hover:brightness-110"
            >
              Grant access
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            className={`cursor-pointer rounded-full border border-[var(--border-strong)] bg-transparent py-3 text-center text-[13px] font-medium text-[var(--foreground-secondary)] transition-colors duration-200 hover:text-[var(--foreground)] ${hasGrantable ? "flex-1" : "w-full"}`}
          >
            Refresh
          </button>
        </div>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-[var(--foreground-muted)]">
          These permissions are used only during live sessions. Nothing is stored or sent beyond your Gemini API calls.
        </p>
      </div>
    </div>
  );
}

function PermissionRow({ item }: { item: PermissionItem }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-3">
      <div className="mt-0.5 flex-shrink-0">
        {item.granted ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--success-muted)]">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="var(--success)" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </span>
        ) : (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-muted)]">
            <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-[13px] font-medium ${item.granted ? "text-[var(--foreground-muted)]" : "text-[var(--foreground)]"}`}>
          {item.label}
        </p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--foreground-muted)]">{item.description}</p>
      </div>
    </div>
  );
}
