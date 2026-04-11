/**
 * Lightweight permissions checker for the Verity extension.
 *
 * Only blocks the UI when something is genuinely broken:
 *   - audioCapture disabled at the Chrome extension level
 *   - Microphone explicitly denied (not "prompt" — that's normal pre-session)
 *
 * Manifest-declared permissions (tabs, storage, etc.) are always present and
 * don't need gating. The mic "prompt" state is fine — getUserMedia will ask
 * when the user starts a session.
 */

export interface PermissionStatus {
  allGranted: boolean;
  items: PermissionItem[];
}

export interface PermissionItem {
  id: string;
  label: string;
  description: string;
  granted: boolean;
  /** True if we can fix this in-app (getUserMedia prompt). False means user must go to Chrome settings. */
  grantable: boolean;
}

export async function checkAllPermissions(): Promise<PermissionStatus> {
  const items: PermissionItem[] = [];

  // audioCapture — the only manifest permission Chrome lets users toggle off.
  const hasAudioCapture = await chromePermissionsContains({
    permissions: ["audioCapture"],
  } as unknown as chrome.permissions.Permissions);
  items.push({
    id: "audioCapture",
    label: "Record audio (Chrome extension)",
    description: "Enable in chrome://extensions \u2192 Verity \u2192 Details.",
    granted: hasAudioCapture,
    grantable: false,
  });

  // Browser mic policy — only block if explicitly "denied".
  // "prompt" is fine; the session-start flow will trigger getUserMedia.
  const micState = await queryBrowserPermission("microphone" as PermissionName);
  const micBlocked = micState === "denied";
  items.push({
    id: "microphone",
    label: "Microphone (browser)",
    description: micBlocked
      ? "Microphone is blocked. Open chrome://settings/content/microphone and allow this extension."
      : "Microphone access will be requested when you start a session.",
    granted: !micBlocked,
    grantable: false, // if denied, user must fix in Chrome settings; if prompt, session handles it
  });

  return {
    allGranted: items.every((i) => i.granted),
    items,
  };
}

/**
 * Attempt to fix what we can. Currently only mic — and only if it's in prompt state
 * (which shouldn't normally reach here since we don't block on prompt).
 */
export async function requestMissingPermissions(current: PermissionStatus): Promise<PermissionStatus> {
  const micItem = current.items.find((i) => i.id === "microphone");
  if (micItem && !micItem.granted) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
    } catch {
      // still denied
    }
  }
  return checkAllPermissions();
}

async function chromePermissionsContains(perms: chrome.permissions.Permissions): Promise<boolean> {
  if (typeof chrome === "undefined" || !chrome.permissions?.contains) return false;
  return new Promise<boolean>((resolve) => {
    chrome.permissions.contains(perms, (has) => resolve(has === true));
  });
}

async function queryBrowserPermission(name: PermissionName): Promise<PermissionState | "unavailable"> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unavailable";
  try {
    const result = await navigator.permissions.query({ name });
    return result.state;
  } catch {
    return "unavailable";
  }
}
