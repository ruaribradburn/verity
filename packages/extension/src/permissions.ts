const button = document.getElementById("grant") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;

button.addEventListener("click", async () => {
  button.disabled = true;
  statusEl.textContent = "Requesting microphone access...";
  statusEl.className = "status";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Stop tracks immediately — we only needed the permission grant.
    for (const track of stream.getTracks()) {
      track.stop();
    }

    statusEl.textContent = "Microphone access granted. You can close this tab.";
    statusEl.className = "status success";

    // Notify the side panel that permission was granted.
    chrome.runtime.sendMessage({ type: "verity:mic-granted" }).catch(() => {});

    // Auto-close after a short delay so the user sees the success message.
    setTimeout(() => window.close(), 1200);
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      statusEl.textContent = "Permission denied. Click the button and press Allow in the Chrome prompt.";
    } else if (name === "NotFoundError") {
      statusEl.textContent = "No microphone found. Connect a mic and try again.";
    } else {
      statusEl.textContent = err instanceof Error ? err.message : "Something went wrong.";
    }
    statusEl.className = "status error";
    button.disabled = false;
  }
});
