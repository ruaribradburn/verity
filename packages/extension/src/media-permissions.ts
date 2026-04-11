/**
 * Central permissions policy for Verity Live in the Chrome extension:
 * extension capabilities (chrome.permissions) + browser mic policy (Permissions API).
 * Screen capture is still requested at runtime via getDisplayMedia from the side panel.
 */

const MIC_QUERY: PermissionDescriptor = { name: "microphone" as PermissionName };

/** Permissions the Live stack may rely on beyond the static manifest list. */
const LIVE_CAPTURE_PERMISSIONS: chrome.permissions.Permissions = {
  permissions: ["audioCapture"],
};

/**
 * Run before starting a Live session (screen + mic). Throws a clear Error if the user
 * must change Chrome settings or grant extension permissions.
 */
export async function ensureLiveSessionMediaPolicy(): Promise<void> {
  await ensureExtensionAudioCapturePermission();
  await ensureBrowserMicrophonePolicy();
}

async function ensureExtensionAudioCapturePermission(): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.permissions) return;

  const has = await new Promise<boolean>((resolve) => {
    chrome.permissions.contains(LIVE_CAPTURE_PERMISSIONS, resolve);
  });
  if (has) return;

  const granted = await new Promise<boolean>((resolve) => {
    chrome.permissions.request(LIVE_CAPTURE_PERMISSIONS, (ok) => {
      resolve(ok === true);
    });
  });

  if (!granted) {
    throw new Error(
      "Verity Live needs the “Record audio” extension permission. Open chrome://extensions → Verity → Details, allow audio capture, then try again.",
    );
  }
}

async function ensureBrowserMicrophonePolicy(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return;

  try {
    const status = await navigator.permissions.query(MIC_QUERY);
    if (status.state === "denied") {
      throw new Error(
        "Microphone access is blocked for this extension. Open chrome://settings/content/microphone, allow Verity, or use the Verity “Grant microphone access” page (from the extension’s permission helper).",
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Microphone")) throw e;
  }
}

/** Opens the bundled permissions helper tab (mic priming + instructions). */
export function openVerityPermissionsTab(): void {
  if (typeof chrome === "undefined" || !chrome.runtime?.getURL || !chrome.tabs?.create) return;
  chrome.tabs.create({ url: chrome.runtime.getURL("permissions.html") });
}
