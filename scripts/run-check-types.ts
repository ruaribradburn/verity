import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const repoRoot = process.cwd();
const packagesDir = path.join(repoRoot, "packages");
const packageDirs = ["api", "client", "extension", "web"];

const bunExe =
  process.execPath.toLowerCase().endsWith("bun.exe") || process.execPath.toLowerCase().endsWith("/bun")
    ? process.execPath
    : "bun";

for (const packageDirName of packageDirs) {
  const packageDir = path.join(packagesDir, packageDirName);
  const packageJsonPath = path.join(packageDir, "package.json");

  if (!existsSync(packageJsonPath)) {
    continue;
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    name?: string;
    scripts?: Record<string, string>;
  };

  if (!packageJson.scripts?.["check-types"]) {
    continue;
  }

  console.log(`[check-types] ${packageJson.name ?? packageDirName}`);
  const exitCode = await runCommand(bunExe, ["run", "check-types"], packageDir);
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

async function runCommand(command: string, args: string[], cwd: string) {
  return await new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      resolve(code ?? 0);
    });
  });
}
