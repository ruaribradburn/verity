#!/usr/bin/env bun
/**
 * Frees listeners on WEB_PORT / API_PORT from repo-root `.env` (defaults 3000 / 3001).
 * macOS/Linux: `lsof` + `kill`. Use `--web` or `--api` to free only one port.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const envPath = resolve(root, ".env");

function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function parsePort(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function sleepMs(ms: number): void {
  try {
    execSync(`sleep ${ms / 1000}`, { stdio: "ignore" });
  } catch {
    /* ignore */
  }
}

function killListenersOnPort(port: number): void {
  const platform = process.platform;
  if (platform !== "darwin" && platform !== "linux") {
    console.warn(
      `[kill-dev-ports] skipping port ${port} on ${platform} (use Task Manager / netstat to free it)`,
    );
    return;
  }

  let pids = "";
  try {
    pids = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return;
  }

  if (!pids) return;

  const pidList = [...new Set(pids.split(/[\s\n]+/).filter(Boolean))];
  console.log(`[kill-dev-ports] freeing :${port} (PID(s): ${pidList.join(", ")})`);

  for (const pid of pidList) {
    try {
      execSync(`kill ${pid}`, { stdio: "ignore" });
    } catch {
      /* ignore */
    }
  }

  sleepMs(300);

  try {
    const still = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
      encoding: "utf8",
    }).trim();
    if (!still) return;
    for (const pid of [...new Set(still.split(/[\s\n]+/).filter(Boolean))]) {
      try {
        execSync(`kill -9 ${pid}`, { stdio: "ignore" });
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* nothing left */
  }
}

const args = process.argv.slice(2);
const onlyWeb = args.includes("--web");
const onlyApi = args.includes("--api");
const killWeb = !onlyApi;
const killApi = !onlyWeb;

const env = parseEnvFile(envPath);
const webPort = parsePort(env.WEB_PORT, 3000);
const apiPort = parsePort(env.API_PORT, 3001);

if (killWeb && killApi && webPort === apiPort) {
  console.error(
    `[kill-dev-ports] WEB_PORT and API_PORT must differ (both ${webPort}). Fix .env.`,
  );
  process.exit(1);
}

if (killWeb) killListenersOnPort(webPort);
if (killApi) killListenersOnPort(apiPort);
