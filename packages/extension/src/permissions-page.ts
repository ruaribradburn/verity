import { checkAllPermissions, requestMissingPermissions } from "./permissions-check";

const listEl = document.getElementById("perm-list") as HTMLUListElement;
const grantBtn = document.getElementById("grant") as HTMLButtonElement;
const refreshBtn = document.getElementById("refresh") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;

async function render() {
  const status = await checkAllPermissions();
  listEl.innerHTML = "";

  for (const item of status.items) {
    const li = document.createElement("li");
    li.className = "perm-item";
    li.innerHTML = `
      <div class="perm-dot ${item.granted ? "granted" : "pending"}"></div>
      <div>
        <div class="perm-name">${item.label}</div>
        <div class="perm-desc">${item.description}</div>
      </div>
    `;
    listEl.appendChild(li);
  }

  if (status.allGranted) {
    statusEl.textContent = "All permissions granted. You can close this tab.";
    statusEl.className = "status success";
    grantBtn.disabled = true;
    chrome.runtime.sendMessage({ type: "verity:mic-granted" }).catch(() => {});
    setTimeout(() => window.close(), 1500);
  }
}

grantBtn.addEventListener("click", async () => {
  grantBtn.disabled = true;
  statusEl.textContent = "Requesting permissions...";
  statusEl.className = "status";

  try {
    const current = await checkAllPermissions();
    const updated = await requestMissingPermissions(current);

    if (updated.allGranted) {
      statusEl.textContent = "All permissions granted. You can close this tab.";
      statusEl.className = "status success";
      chrome.runtime.sendMessage({ type: "verity:mic-granted" }).catch(() => {});
      setTimeout(() => window.close(), 1500);
    } else {
      const missing = updated.items.filter((i) => !i.granted);
      statusEl.textContent = `Still missing: ${missing.map((i) => i.label).join(", ")}. Check your Chrome settings.`;
      statusEl.className = "status error";
      grantBtn.disabled = false;
    }

    await render();
  } catch (err) {
    statusEl.textContent = err instanceof Error ? err.message : "Something went wrong.";
    statusEl.className = "status error";
    grantBtn.disabled = false;
  }
});

refreshBtn.addEventListener("click", () => render());

render();
