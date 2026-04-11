import { useCallback, useEffect, useState } from "react";
import {
  checkAllPermissions,
  requestMissingPermissions,
  type PermissionStatus,
  type PermissionItem,
} from "../permissions-check";

interface Props {
  children: React.ReactNode;
}

/**
 * Wraps the main app. If any required permission is missing,
 * shows a full-screen permissions page instead of the app.
 */
export function PermissionsGate({ children }: Props) {
  const [status, setStatus] = useState<PermissionStatus | null>(null);
  const [granting, setGranting] = useState(false);

  const refresh = useCallback(async () => {
    const s = await checkAllPermissions();
    setStatus(s);
  }, []);

  useEffect(() => {
    refresh();

    // Re-check when the side panel regains focus (user may have changed settings externally).
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  // Listen for mic-granted messages from the permissions helper tab.
  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) return;
    const handler = (msg: { type?: string }) => {
      if (msg.type === "verity:mic-granted") refresh();
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, [refresh]);

  // Still loading initial check
  if (!status) return null;

  // All good — render the app
  if (status.allGranted) return <>{children}</>;

  // Show the permissions page
  return <PermissionsPage status={status} granting={granting} onGrant={handleGrant} onRefresh={refresh} />;

  async function handleGrant() {
    setGranting(true);
    try {
      const updated = await requestMissingPermissions(status!);
      setStatus(updated);
    } finally {
      setGranting(false);
    }
  }
}

function PermissionsPage({
  status,
  granting,
  onGrant,
  onRefresh,
}: {
  status: PermissionStatus;
  granting: boolean;
  onGrant: () => void;
  onRefresh: () => void;
}) {
  const missing = status.items.filter((i) => !i.granted);
  const hasUngrantable = missing.some((i) => !i.grantable);

  return (
    <div className="flex min-h-screen items-center justify-center p-3 sm:px-6">
      <div className="w-full max-w-xl border border-[var(--border)] bg-[rgba(6,17,18,0.72)] shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur">
        <header className="border-b border-[var(--border)] px-6 py-5">
          <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--foreground-muted)]">
            Verity permissions
          </p>
          <h1 className="mt-1 text-[15px] font-medium text-[var(--foreground)]">Permissions required</h1>
          <p className="mt-1 max-w-3xl text-[11px] leading-5 text-[var(--foreground-muted)]">
            Verity needs the following permissions to run voice sessions and page research in the side
            panel. Grant everything below, then continue.
          </p>
        </header>

        <div className="px-6 py-5">
          <div className="border border-[var(--border)] bg-[rgba(6,17,18,0.35)] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--foreground-muted)]">
                  Status
                </p>
                <p className="mt-1 text-[11px] text-[var(--foreground)]">
                  {missing.length === 0
                    ? "All required permissions granted."
                    : `${missing.length} permission${missing.length === 1 ? "" : "s"} still required.`}
                </p>
              </div>
              <span className="inline-flex h-9 items-center border border-[var(--border)] bg-[rgba(8,28,29,0.55)] px-3 font-mono text-[11px] text-[var(--foreground-muted)]">
                {status.items.filter((item) => item.granted).length}/{status.items.length} ready
              </span>
            </div>
          </div>

          <ul className="mt-4 space-y-3">
            {status.items.map((item) => (
              <PermissionRow key={item.id} item={item} />
            ))}
          </ul>

          {hasUngrantable && (
            <div className="mt-4 border border-[#5d302f] bg-[rgba(60,20,18,0.45)] px-4 py-3">
              <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-[#d29c9c]">
                Browser setting required
              </p>
              <p className="mt-1 text-[11px] leading-5 text-[#f0cccc]">
                Some permissions were denied at the browser level. Open{" "}
                <strong>chrome://settings/content/microphone</strong> to allow Verity, then return here.
              </p>
            </div>
          )}

          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={onGrant}
              disabled={granting}
              className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-[1px] border border-[var(--border-strong)] bg-[rgba(65,96,93,0.16)] px-3 text-[11px] tracking-[0.01em] text-[var(--foreground)] transition-colors hover:border-[var(--accent)] disabled:cursor-wait disabled:opacity-45"
            >
              {granting ? "Granting..." : "Grant all permissions"}
            </button>
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex h-9 items-center justify-center rounded-[1px] border border-[var(--border)] bg-[rgba(8,28,29,0.55)] px-4 text-[11px] tracking-[0.01em] text-[var(--foreground)] transition-colors hover:border-[var(--border-strong)]"
            >
              Refresh
            </button>
          </div>

          <p className="mt-4 text-[11px] leading-5 text-[var(--foreground-muted)]">
            Verity only uses these permissions for voice sessions and page research. Nothing leaves
            your device except Gemini API calls.
          </p>
        </div>
      </div>
    </div>
  );
}

function PermissionRow({ item }: { item: PermissionItem }) {
  return (
    <li className="flex items-start gap-3 border border-[var(--border)] bg-[rgba(8,28,29,0.55)] px-4 py-3">
      <div className="mt-0.5 flex-shrink-0">
        {item.granted ? (
          <div className="flex h-5 w-5 items-center justify-center border border-[#33594e] bg-[#123329]">
            <svg className="h-3 w-3 text-[#9fd0bc]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        ) : (
          <div className="flex h-5 w-5 items-center justify-center border border-[#4e4a35] bg-[#262112]">
            <div className="h-2 w-2 bg-[#d9c8a0]" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className={`text-[12px] ${item.granted ? "text-[var(--foreground-muted)]" : "text-[var(--foreground)]"}`}>
            {item.label}
          </p>
          <span
            className={`font-mono text-[10px] uppercase tracking-[0.12em] ${
              item.granted ? "text-[#9fd0bc]" : "text-[#d9c8a0]"
            }`}
          >
            {item.granted ? "ready" : "pending"}
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-5 text-[var(--foreground-muted)]">{item.description}</p>
      </div>
    </li>
  );
}
