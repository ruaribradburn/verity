import { useCallback, useEffect, useState } from "react";
import {
  checkAllPermissions,
  requestMissingPermissions,
  type PermissionItem,
  type PermissionStatus,
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

  return <PermissionsPage status={status} granting={granting} onGrant={handleGrant} onRefresh={refresh} />;

  async function handleGrant() {
    if (!status) return;
    setGranting(true);
    try {
      const updated = await requestMissingPermissions(status);
      setStatus(updated);
    } finally {
      setGranting(false);
    }
  }
}

function PermissionsPage({
  status,
  onRefresh,
}: {
  status: PermissionStatus;
  onRefresh: () => void;
}) {
  const missing = status.items.filter((item) => !item.granted);
  const hasGrantable = missing.some((item) => item.grantable);
  const missingExtensionOrHost = missing.some((item) => item.id === "extension" || item.id === "host");
  const micDenied = missing.some((item) => item.id === "microphone" && !item.grantable);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4efe6] p-6">
      <div className="w-full max-w-md rounded-[2rem] border border-black/8 bg-white px-7 py-8 shadow-[0_18px_60px_rgba(0,0,0,0.06)]">
        <p className="text-xs uppercase tracking-[0.34em] text-amber-700">Verity permissions</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-stone-900">
          Setup needed
        </h1>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          Verity needs the following permissions to work.
          {hasGrantable
            ? " Grant microphone access below, then refresh if needed."
            : " Follow any manual steps below, then click Refresh."}
        </p>

        <ul className="mt-6 space-y-3">
          {missing.map((item) => (
            <PermissionRow key={item.id} item={item} />
          ))}
        </ul>

        {micDenied && (
          <div className="mt-5 rounded-xl bg-red-50 px-4 py-3">
            <p className="text-xs leading-5 text-red-800">
              Microphone access was denied at the browser level. Open{" "}
              <strong>chrome://settings/content/microphone</strong>, allow Verity, then click Refresh.
            </p>
          </div>
        )}

        {missingExtensionOrHost && (
          <div className="mt-5 rounded-xl bg-amber-50 px-4 py-3">
            <p className="text-xs font-medium text-amber-900">Extension reinstall may be required</p>
            <p className="mt-1 text-xs leading-5 text-amber-800">
              Verity is missing manifest-backed permissions that should have been granted at install time.
              Reload the unpacked extension or reinstall it from the latest build, then click{" "}
              <strong>Refresh</strong>.
            </p>
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
