/**
 * Permission status for the Verity extension.
 *
 * The manifest already grants the extension and host permissions at install
 * time, so the only runtime gate we can meaningfully fix in-app is browser
 * microphone access. We still surface the manifest-backed permissions to make
 * the status page explicit when something is wrong with the installed build.
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
  /**
   * True when the UI can try to recover in-app. False means the user must
   * change browser or extension settings manually.
   */
  grantable: boolean;
}

const CORE_EXTENSION_PERMISSIONS: chrome.permissions.Permissions = {
  permissions: ["sidePanel", "storage", "tabs", "scripting", "activeTab", "search", "alarms", "tabGroups"],
};

const REQUIRED_HOST_PERMISSIONS: chrome.permissions.Permissions = {
  origins: ["http://127.0.0.1:3001/*", "http://localhost:3001/*", "<all_urls>"],
};

export async function checkAllPermissions(): Promise<PermissionStatus> {
  const items: PermissionItem[] = [];

  const hasCorePerms = await chromePermissionsContains(CORE_EXTENSION_PERMISSIONS);
  items.push({
    id: "extension",
    label: "Extension core permissions",
    description: "Side panel, tabs, storage, scripting, alarms, and research automation.",
    granted: hasCorePerms,
    grantable: false,
  });

  const hasHostPerms = await chromePermissionsContains(REQUIRED_HOST_PERMISSIONS);
  items.push({
    id: "host",
    label: "Page and API access",
    description: "Read active pages and call the local Verity API during live sessions.",
    granted: hasHostPerms,
    grantable: false,
  });

  const micState = await queryBrowserPermission("microphone" as PermissionName);
  const micBlocked = micState === "denied";
  items.push({
    id: "microphone",
    label: "Microphone (browser)",
    description: micBlocked
      ? "Microphone is BLOCKED. You must go to chrome://settings/content/microphone and allow Verity manually."
      : "Microphone access is required for live voice. It will be requested when you start a session.",
    granted: micState === "granted",
    grantable: micState !== "denied",
  });

  return {
    allGranted: items.every((item) => item.granted),
    items,
  };
}

export async function requestMissingPermissions(current: PermissionStatus): Promise<PermissionStatus> {
  const microphone = current.items.find((item) => item.id === "microphone");
  if (microphone && microphone.grantable && !microphone.granted) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) {
        track.stop();
      }
    } catch {
      // Re-check below and surface the current browser state.
    }
  }

  return checkAllPermissions();
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

async function queryBrowserPermission(name: PermissionName): Promise<PermissionState | "unavailable"> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unavailable";
  try {
    const result = await navigator.permissions.query({ name });
    return result.state;
  } catch {
    return "unavailable";
  }
}
