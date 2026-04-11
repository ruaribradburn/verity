const button = document.getElementById("grant") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLDivElement;

button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Requesting microphone access...";
  status.className = "status";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Stop tracks immediately — we only needed the permission grant.
    for (const track of stream.getTracks()) {
      track.stop();
    }

    status.textContent = "Microphone access granted. You can close this tab.";
    status.className = "status success";

    // Notify the side panel that permission was granted.
    chrome.runtime.sendMessage({ type: "verity:mic-granted" }).catch(() => {});

    // Auto-close after a short delay so the user sees the success message.
    setTimeout(() => window.close(), 1200);
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      status.textContent = "Permission denied. Click the button and press Allow in the Chrome prompt.";
    } else if (name === "NotFoundError") {
      status.textContent = "No microphone found. Connect a mic and try again.";
    } else {
      status.textContent = err instanceof Error ? err.message : "Something went wrong.";
    }
    status.className = "status error";
    button.disabled = false;
  }
});
