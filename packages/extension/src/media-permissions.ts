/**
 * Central permissions policy for Verity Live in the Chrome extension.
 * Screen capture is still requested at runtime via getDisplayMedia from the side panel.
 */

const MIC_QUERY: PermissionDescriptor = { name: "microphone" as PermissionName };

/**
 * Run before starting a Live session (screen + mic). Throws a clear Error if the user
 * must change Chrome's microphone settings.
 */
export async function ensureLiveSessionMediaPolicy(): Promise<void> {
  await ensureBrowserMicrophonePolicy();
}

async function ensureBrowserMicrophonePolicy(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return;

  try {
    const status = await navigator.permissions.query(MIC_QUERY);
    if (status.state === "denied") {
      throw new Error(
        "Microphone access is blocked for this extension. Open chrome://settings/content/microphone, allow Verity, or use the Verity \"Grant microphone access\" page.",
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
