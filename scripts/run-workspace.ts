import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

type WorkspaceName = "web" | "api";
type ScriptName = "dev" | "build" | "start";

const [, , workspace, script] = process.argv as [
  string,
  string,
  WorkspaceName | undefined,
  ScriptName | undefined,
];

if (!workspace || !script || !isWorkspace(workspace) || !isScript(script)) {
  console.error("Usage: bun scripts/run-workspace.ts <web|api> <dev|build|start>");
  process.exit(1);
}

const repoRoot = process.cwd();
const envPath = path.join(repoRoot, ".env");
const workspaceDir = path.join(repoRoot, "packages", workspace);
const envFromFile = loadDotEnv(envPath);
const env = { ...process.env, ...envFromFile };

if (workspace === "web") {
  env.PORT = env.WEB_PORT ?? env.PORT ?? "3000";
}

if (workspace === "api") {
  env.PORT = env.API_PORT ?? env.PORT ?? "3001";
}

const bunExe =
  process.execPath.toLowerCase().endsWith("bun.exe") || process.execPath.toLowerCase().endsWith("/bun")
    ? process.execPath
    : "bun";

const child = spawn(bunExe, ["run", script], {
  cwd: workspaceDir,
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

function loadDotEnv(filePath: string) {
  if (!existsSync(filePath)) return {} as Record<string, string>;

  const content = readFileSync(filePath, "utf8");
  const entries: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    entries[key] = value;
  }

  return entries;
}

function isWorkspace(value: string): value is WorkspaceName {
  return value === "web" || value === "api";
}

function isScript(value: string): value is ScriptName {
  return value === "dev" || value === "build" || value === "start";
}
