import { execFile } from "node:child_process";
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = await mkdtemp(path.join(tmpdir(), "codey-launcher-contract-"));
const dockerLog = path.join(directory, "docker.log");

try {
  const result = process.platform === "win32"
    ? await validateWindowsLauncher()
    : await validateShellLauncher();
  const commandLog = await readFile(dockerLog, "utf8");

  if (!result.stdout.includes("http://localhost:4099/install#token=contract-install-token")) {
    throw new Error(`Launcher did not print the one-time setup URL. Output: ${result.stdout}`);
  }
  if (!commandLog.includes("up -d --build --wait --wait-timeout 180")) {
    throw new Error("Launcher did not wait for the self-host stack.");
  }
  if (!commandLog.includes("--print-install-token")) {
    throw new Error("Launcher did not request the persisted installation token.");
  }

  console.log(`Validated the ${process.platform} self-host launcher contract.`);
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function validateShellLauncher() {
  const dockerPath = path.join(directory, "docker");
  await writeFile(dockerPath, [
    "#!/bin/sh",
    "printf '%s\\n' \"$*\" >> \"$CODEY_DOCKER_LOG\"",
    "case \"$*\" in",
    "  *--print-install-token*) printf 'contract-install-token' ;;",
    "esac"
  ].join("\n"));
  await chmod(dockerPath, 0o755);
  await execFileAsync("sh", ["-n", "start-codey.sh"], { cwd: root });

  return execFileAsync("sh", ["start-codey.sh", "--no-open"], {
    cwd: root,
    env: launcherEnvironment(directory)
  });
}

async function validateWindowsLauncher() {
  const dockerPath = path.join(directory, "docker.exe");
  const preloadPath = path.join(directory, "docker-preload.cjs");
  await copyFile(process.execPath, dockerPath);
  await writeFile(preloadPath, [
    'const fs = require("node:fs");',
    "const args = process.argv.slice(1);",
    'fs.appendFileSync(process.env.CODEY_DOCKER_LOG, `${args.join(" ")}\\n`);',
    'if (args.includes("--print-install-token")) process.stdout.write("contract-install-token");',
    "process.exit(0);"
  ].join("\n"));

  return execFileAsync(process.env.ComSpec || "cmd.exe", ["/d", "/c", "start-codey.cmd", "--no-open"], {
    cwd: root,
    env: {
      ...launcherEnvironment(directory),
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require=${preloadPath}`.trim()
    }
  });
}

function launcherEnvironment(binDirectory) {
  return {
    ...process.env,
    API_PORT: "4099",
    APP_PUBLIC_URL: "",
    CORS_ORIGINS: "",
    CODEY_NO_OPEN: "true",
    CODEY_DOCKER_LOG: dockerLog,
    PATH: `${binDirectory}${path.delimiter}${process.env.PATH || ""}`
  };
}
