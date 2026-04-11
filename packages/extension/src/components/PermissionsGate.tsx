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
  const hasGrantable = missing.some((i) => i.grantable);
  const needsAudioCapture = missing.some((i) => i.id === "audioCapture");
  const micDenied = missing.some((i) => i.id === "microphone" && !i.grantable);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4efe6] p-6">
      <div className="w-full max-w-md rounded-[2rem] border border-black/8 bg-white px-7 py-8 shadow-[0_18px_60px_rgba(0,0,0,0.06)]">
        <p className="text-xs uppercase tracking-[0.34em] text-amber-700">Verity permissions</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-stone-900">
          Permissions required
        </h1>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          Verity needs the following permissions to work.
          {hasGrantable
            ? " Grant what you can below, then follow any manual steps."
            : " Follow the instructions below, then click Refresh."}
        </p>

        <ul className="mt-6 space-y-3">
          {status.items.map((item) => (
            <PermissionRow key={item.id} item={item} />
          ))}
        </ul>

        {needsAudioCapture && (
          <div className="mt-5 rounded-xl bg-amber-50 px-4 py-3">
            <p className="text-xs font-medium text-amber-900">Chrome audio capture required</p>
            <p className="mt-1 text-xs leading-5 text-amber-800">
              Go to <strong>chrome://extensions</strong>, find <strong>Verity</strong>, click{" "}
              <strong>Details</strong>, and make sure <strong>&ldquo;Record audio&rdquo;</strong> is
              enabled. Then click <strong>Refresh</strong> below.
            </p>
          </div>
        )}

        {micDenied && (
          <div className="mt-5 rounded-xl bg-red-50 px-4 py-3">
            <p className="text-xs leading-5 text-red-800">
              Microphone access was denied at the browser level. Open{" "}
              <strong>chrome://settings/content/microphone</strong>, allow Verity, then click
              Refresh.
            </p>
          </div>
        )}

        <div className="mt-6 flex gap-3">
          {hasGrantable && (
            <button
              type="button"
              onClick={onGrant}
              disabled={granting}
              className="flex-1 rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-amber-700 disabled:cursor-wait disabled:opacity-70"
            >
              {granting ? "Granting..." : "Grant microphone access"}
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            className={`rounded-full border border-stone-300 bg-white px-5 py-3 text-sm font-medium text-stone-700 transition hover:border-stone-900 hover:text-stone-900 ${hasGrantable ? "" : "flex-1"}`}
          >
            Refresh
          </button>
        </div>

        <p className="mt-4 text-center text-xs text-stone-400">
          Verity only uses these permissions for voice sessions and page research. Nothing leaves
          your device except Gemini API calls.
        </p>
      </div>
    </div>
  );
}

function PermissionRow({ item }: { item: PermissionItem }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
      <div className="mt-0.5 flex-shrink-0">
        {item.granted ? (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100">
            <svg className="h-3 w-3 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        ) : (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-100">
            <div className="h-2 w-2 rounded-full bg-amber-500" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${item.granted ? "text-stone-500" : "text-stone-900"}`}>
          {item.label}
        </p>
        <p className="mt-0.5 text-xs leading-5 text-stone-500">{item.description}</p>
      </div>
    </li>
  );
}
