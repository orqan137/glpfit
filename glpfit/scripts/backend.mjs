import { existsSync, watch } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localUv = path.join(
  root,
  ".tools",
  process.platform === "win32" ? "uv.exe" : "uv",
);
const uv = existsSync(localUv) ? localUv : "uv";
let child;
let stopping = false;
let restarting = false;
let timer;

const watchDirs = ["be", "agent"].map((dir) => path.join(root, dir));

function start() {
  const pythonPath = watchDirs.join(path.delimiter);
  child = spawn(
    uv,
    [
      "run",
      "--locked",
      "uvicorn",
      "glpfit_be.api:app",
      "--host",
      "127.0.0.1",
      "--port",
      "8000",
    ],
    {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONPATH: process.env.PYTHONPATH
          ? `${pythonPath}${path.delimiter}${process.env.PYTHONPATH}`
          : pythonPath,
      },
      detached: true,
    },
  );
  child.on("error", (error) => {
    console.error(
      `Could not start FastAPI: ${error.message}. Run scripts/setup.ps1 first.`,
    );
    closeWatchers();
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    if (!restarting && !stopping) {
      closeWatchers();
      process.exitCode = code ?? 1;
    }
  });
}

function terminate() {
  const current = child;
  if (!current?.pid || current.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    current.once("close", resolve);
    if (process.platform === "win32") {
      // Kill only our uv/Python tree. Avoid console signals that also stop Vite.
      const cleanup = spawn(
        "taskkill",
        ["/PID", String(current.pid), "/T", "/F"],
        {
          windowsHide: true,
          stdio: "ignore",
        },
      );
      cleanup.on("error", () => current.kill());
    } else {
      process.kill(-current.pid, "SIGTERM");
    }
  });
}

// Own the reload cycle: uvicorn's Windows console signals can interrupt sibling servers.
const watchers = watchDirs.map((dir) =>
  watch(dir, { recursive: true }, (_event, filename) => {
    if (!filename?.endsWith(".py") || stopping) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (restarting || stopping) return;
      restarting = true;
      console.log("Python source changed; restarting FastAPI...");
      await terminate();
      if (!stopping) start();
      restarting = false;
    }, 250);
  }),
);

function closeWatchers() {
  for (const watcher of watchers) watcher.close();
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    clearTimeout(timer);
    closeWatchers();
    await terminate();
    process.exitCode = 0;
  });
}

start();
