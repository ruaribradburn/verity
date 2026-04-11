/**
 * Comprehensive permissions checker for the Verity extension.
 *
 * Manifest-declared permissions are always granted — we only need to verify
 * they're present (they will be). The real gates are:
 *   1. audioCapture at the Chrome extension level (can be toggled off by users)
 *   2. Browser-level microphone policy (getUserMedia grant)
 *
 * We NEVER call chrome.permissions.request() for permissions already in the
 * manifest — Chrome throws "Only permissions specified in the manifest may be
 * requested" for required (non-optional) permissions.
 */

export interface PermissionStatus {
  /** All required permissions are granted. */
  allGranted: boolean;
  /** Per-permission breakdown. */
  items: PermissionItem[];
}

export interface PermissionItem {
  id: string;
  label: string;
  description: string;
  granted: boolean;
  /** Whether the user can grant this in-app (vs needing to go to chrome://settings). */
  grantable: boolean;
}

/**
 * Check all permissions Verity needs and return a structured status.
 */
export async function checkAllPermissions(): Promise<PermissionStatus> {
  const items: PermissionItem[] = [];

  // 1. Core manifest permissions — these are always present if the manifest is correct.
  //    We verify with contains() but never request() them.
  const hasCorePerms = await chromePermissionsContains({
    permissions: ["sidePanel", "storage", "tabs", "scripting", "activeTab", "search", "alarms", "tabGroups"],
  });
  items.push({
    id: "extension",
    label: "Extension core permissions",
    description: "Side panel, tabs, storage, scripting, and other core capabilities.",
    granted: hasCorePerms,
    grantable: false, // manifest-declared, can't be requested at runtime
  });

  // 2. audioCapture — declared in the manifest but Chrome lets users disable it
  //    in chrome://extensions → Details. We can only check, not re-request.
  const hasAudioCapture = await chromePermissionsContains({
    permissions: ["audioCapture"],
  } as unknown as chrome.permissions.Permissions);
  items.push({
    id: "audioCapture",
    label: "Record audio (Chrome extension)",
    description: "Chrome-level audio capture. If missing, open chrome://extensions \u2192 Verity \u2192 Details and enable it.",
    granted: hasAudioCapture,
    grantable: false, // must be enabled in chrome://extensions, not requestable
  });

  // 3. Host permissions — declared in manifest, just verify.
  const hasHostPerms = await chromePermissionsContains({
    origins: ["http://127.0.0.1:3001/*", "http://localhost:3001/*"],
  });
  items.push({
    id: "host",
    label: "Local API access",
    description: "Access to the Verity API running on localhost.",
    granted: hasHostPerms,
    grantable: false,
  });

  // 4. Microphone browser policy — this IS grantable via getUserMedia prompt.
  const micStatus = await queryBrowserPermission("microphone" as PermissionName);
  items.push({
    id: "microphone",
    label: "Microphone (browser)",
    description: "Browser-level microphone access for voice input during live sessions.",
    granted: micStatus === "granted",
    grantable: micStatus !== "denied",
  });

  return {
    allGranted: items.every((i) => i.granted),
    items,
  };
}

/**
 * Attempt to grant missing permissions that can be granted programmatically.
 * Only microphone access can actually be requested at runtime — manifest
 * permissions and audioCapture must be fixed by the user in Chrome settings.
 */
export async function requestMissingPermissions(current: PermissionStatus): Promise<PermissionStatus> {
  for (const item of current.items) {
    if (item.granted || !item.grantable) continue;

    if (item.id === "microphone") {
      await requestMicrophoneAccess();
    }
  }

  return checkAllPermissions();
}

/** Grant microphone access by triggering a getUserMedia prompt. */
async function requestMicrophoneAccess(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
  } catch {
    // User denied or no mic — will show as not granted on re-check
  }
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
