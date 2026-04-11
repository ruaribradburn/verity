#!/usr/bin/env bun
/**
 * Creates repo-root `.venv` and installs `trafilatura` there (avoids Homebrew PEP 668 "externally managed" errors).
 * Run: bun run setup:trafilatura
 *
 * The API auto-uses `.venv/bin/python` when present (see packages/api trafilaturaPythonCandidates).
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(scriptsDir, "..");
const req = path.join(scriptsDir, "requirements.txt");
const venvDir = path.join(repoRoot, ".venv");

function venvPythonPath(): string {
  if (process.platform === "win32") {
    return path.join(venvDir, "Scripts", "python.exe");
  }
  const py3 = path.join(venvDir, "bin", "python3");
  const py = path.join(venvDir, "bin", "python");
  if (existsSync(py3)) return py3;
  return py;
}

const systemCandidates =
  process.platform === "win32" ? (["python", "python3"] as const) : (["python3", "python"] as const);

function findSystemPython(): string | null {
  for (const py of systemCandidates) {
    const r = spawnSync(py, ["-c", "import sys"], { encoding: "utf8" });
    if (r.status === 0) return py;
  }
  return null;
}

const sysPy = findSystemPython();
if (!sysPy) {
  console.error(
    "[verity] No Python 3 found. On macOS:\n" +
      "  brew install python\n" +
      "Then: bun run setup:trafilatura\n",
  );
  process.exit(1);
}

if (!existsSync(venvDir)) {
  console.log(`[verity] Creating virtualenv at ${venvDir} …`);
  const create = spawnSync(sysPy, ["-m", "venv", venvDir], { stdio: "inherit" });
  if (create.status !== 0) {
    console.error("[verity] Failed to create .venv");
    process.exit(1);
  }
}

const venvPy = venvPythonPath();
if (!existsSync(venvPy)) {
  console.error(`[verity] Expected ${venvPy} after venv create`);
  process.exit(1);
}

const pipUpgrade = spawnSync(venvPy, ["-m", "pip", "install", "--upgrade", "pip"], { stdio: "inherit" });
if (pipUpgrade.status !== 0) process.exit(1);

const install = spawnSync(venvPy, ["-m", "pip", "install", "-r", req], { stdio: "inherit" });
if (install.status !== 0) process.exit(1);

console.log("[verity] trafilatura installed in .venv");
console.log(`[verity] API will use this interpreter automatically. Optional .env override:\n  PYTHON_BIN=${venvPy}`);
