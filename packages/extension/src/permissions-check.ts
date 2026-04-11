/**
 * Comprehensive permissions checker for the Verity extension.
 *
 * Checks both Chrome extension permissions and browser-level media policies.
 * Returns a structured status so the UI can show exactly what's missing.
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

/** Core extension permissions. */
const CORE_EXTENSION_PERMISSIONS: chrome.permissions.Permissions = {
  permissions: ["sidePanel", "storage", "tabs", "scripting", "activeTab", "search", "alarms", "tabGroups"],
};

/** Host permissions Verity needs for the local API. */
const REQUIRED_HOST_PERMISSIONS: chrome.permissions.Permissions = {
  origins: ["http://127.0.0.1:3001/*", "http://localhost:3001/*"],
};

/**
 * Check all permissions Verity needs and return a structured status.
 */
export async function checkAllPermissions(): Promise<PermissionStatus> {
  const items: PermissionItem[] = [];

  const hasCorePerms = await chromePermissionsContains(CORE_EXTENSION_PERMISSIONS);
  items.push({
    id: "extension",
    label: "Extension core permissions",
    description: "Side panel, tabs, storage, scripting, and other core capabilities.",
    granted: hasCorePerms,
    grantable: true,
  });

  const hasHostPerms = await chromePermissionsContains(REQUIRED_HOST_PERMISSIONS);
  items.push({
    id: "host",
    label: "Local API access",
    description: "Access to the Verity API running on localhost.",
    granted: hasHostPerms,
    grantable: true,
  });

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
 * Attempt to grant all missing permissions. Returns updated status.
 */
export async function requestMissingPermissions(current: PermissionStatus): Promise<PermissionStatus> {
  for (const item of current.items) {
    if (item.granted) continue;

    switch (item.id) {
      case "extension":
        await requestChromePermissions(CORE_EXTENSION_PERMISSIONS);
        break;
      case "host":
        await requestChromePermissions(REQUIRED_HOST_PERMISSIONS);
        break;
      case "microphone":
        await requestMicrophoneAccess();
        break;
    }
  }

  return checkAllPermissions();
}

async function requestMicrophoneAccess(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
  } catch {
    // User denied or no mic; re-check will report the current state.
  }
}

async function chromePermissionsContains(perms: chrome.permissions.Permissions): Promise<boolean> {
  if (typeof chrome === "undefined" || !chrome.permissions?.contains) return false;
  return new Promise<boolean>((resolve) => {
    chrome.permissions.contains(perms, (has) => {
      if (chrome.runtime.lastError) {
        console.warn("[verity/permissions] contains failed:", chrome.runtime.lastError.message);
        resolve(false);
        return;
      }
      resolve(has === true);
    });
  });
}

async function requestChromePermissions(perms: chrome.permissions.Permissions): Promise<boolean> {
  if (typeof chrome === "undefined" || !chrome.permissions?.request) return false;
  return new Promise<boolean>((resolve) => {
    chrome.permissions.request(perms, (granted) => {
      if (chrome.runtime.lastError) {
        console.warn("[verity/permissions] request failed:", chrome.runtime.lastError.message);
        resolve(false);
        return;
      }
      resolve(granted === true);
    });
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
