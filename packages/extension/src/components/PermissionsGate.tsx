import { useCallback, useEffect, useState } from "react";
import {
  checkAllPermissions,
  type PermissionStatus,
  type PermissionItem,
} from "../permissions-check";

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
    setStatus(await checkAllPermissions());
  }, []);

  useEffect(() => {
    // Initial check on mount — wrapped in microtask to avoid sync setState in effect body.
    void Promise.resolve().then(refresh);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) return;
    const handler = (msg: { type?: string }) => {
      if (msg.type === "verity:mic-granted") refresh();
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, [refresh]);

  if (!status) return null;
  if (status.allGranted) return <>{children}</>;

  return <PermissionsPage status={status} onRefresh={refresh} />;
}

function PermissionsPage({
  status,
  onRefresh,
}: {
  status: PermissionStatus;
  onRefresh: () => void;
}) {
  const missing = status.items.filter((i) => !i.granted);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4efe6] p-6">
      <div className="w-full max-w-md rounded-[2rem] border border-black/8 bg-white px-7 py-8 shadow-[0_18px_60px_rgba(0,0,0,0.06)]">
        <p className="text-xs uppercase tracking-[0.34em] text-amber-700">Verity permissions</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-stone-900">
          Setup needed
        </h1>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          Verity can&apos;t start because a required permission is off. Fix the items below in Chrome
          settings, then click <strong>Refresh</strong>.
        </p>

        <ul className="mt-6 space-y-3">
          {missing.map((item) => (
            <PermissionRow key={item.id} item={item} />
          ))}
        </ul>

        {missing.some((i) => i.id === "audioCapture") && (
          <div className="mt-5 rounded-xl bg-amber-50 px-4 py-3">
            <p className="text-xs font-medium text-amber-900">How to fix</p>
            <ol className="mt-1.5 list-inside list-decimal text-xs leading-6 text-amber-800">
              <li>Open <strong>chrome://extensions</strong> in a new tab</li>
              <li>Find <strong>Verity</strong> and click <strong>Details</strong></li>
              <li>Scroll to <strong>&ldquo;Record audio&rdquo;</strong> and toggle it on</li>
              <li>Come back here and click <strong>Refresh</strong></li>
            </ol>
          </div>
        )}

        {missing.some((i) => i.id === "microphone") && (
          <div className="mt-5 rounded-xl bg-red-50 px-4 py-3">
            <p className="text-xs font-medium text-red-900">How to fix</p>
            <ol className="mt-1.5 list-inside list-decimal text-xs leading-6 text-red-800">
              <li>Open <strong>chrome://settings/content/microphone</strong></li>
              <li>Remove Verity from the blocked list (or add to allowed)</li>
              <li>Come back here and click <strong>Refresh</strong></li>
            </ol>
          </div>
        )}

        <button
          type="button"
          onClick={onRefresh}
          className="mt-6 w-full rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-amber-700"
        >
          Refresh
        </button>

        <p className="mt-4 text-center text-xs text-stone-400">
          Verity only uses these permissions for voice sessions and page research.
        </p>
      </div>
    </div>
  );
}

function PermissionRow({ item }: { item: PermissionItem }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
      <div className="mt-0.5 flex-shrink-0">
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-red-100">
          <svg className="h-3 w-3 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-stone-900">{item.label}</p>
        <p className="mt-0.5 text-xs leading-5 text-stone-500">{item.description}</p>
      </div>
    </li>
  );
}
