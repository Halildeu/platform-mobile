import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { monitorTransport } from "./e2e-maestro-transport.mjs";

const runId = process.env.GITHUB_RUN_ID;
const attempt = process.env.GITHUB_RUN_ATTEMPT;
const commit = process.env.GITHUB_SHA;
assert.match(runId ?? "", /^\d+$/);
assert.match(attempt ?? "", /^[1-9]\d*$/);
assert.match(commit ?? "", /^[a-f0-9]{40}$/);
const directory = "artifacts/maestro";
mkdirSync(directory, { recursive: true });
const evidence = {
  schema: "mobile-maestro-diagnostics/v1",
  runId,
  attempt,
  commit,
  steps: [],
};

function outcome(result) {
  return {
    exitCode: result.status,
    signal: result.signal,
    error: result.error?.code ?? null,
  };
}

function snapshot(phase) {
  const state = spawnSync("adb", ["-s", "emulator-5554", "get-state"], {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 4096,
  });
  const boot = spawnSync(
    "adb",
    ["-s", "emulator-5554", "shell", "getprop", "sys.boot_completed"],
    {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 4096,
    },
  );
  const value = state.stdout?.trim();
  // Only allowlisted state and command outcomes enter diagnostics, never raw logs.
  evidence.steps.push({
    phase,
    at: new Date().toISOString(),
    deviceState: ["device", "offline", "unauthorized"].includes(value)
      ? value
      : "unknown",
    stateProbe: outcome(state),
    bootCompleted: boot.status === 0 && boot.stdout?.trim() === "1",
    bootProbe: outcome(boot),
  });
}

function execute(name, command, args, timeout) {
  const start = performance.now();
  const result = spawnSync(command, args, {
    stdio: "inherit",
    timeout,
    killSignal: "SIGKILL",
  });
  evidence.steps.push({
    phase: name,
    elapsedMs: Math.round(performance.now() - start),
    ...outcome(result),
  });
  return result.status ?? 1;
}

snapshot("before-install");
let status = execute(
  "install",
  "adb",
  ["-s", "emulator-5554", "install", "-r", "artifacts/apk/app-release.apk"],
  120000,
);
snapshot("after-install");
if (status === 0) {
  const monitor = monitorTransport();
  const start = performance.now();
  const result = await new Promise((resolve) => {
    const child = spawn(
      "maestro",
      [
        "test",
        "-e",
        "APP_ID=com.workcube.meeting",
        "--format",
        "junit",
        "--output",
        `${directory}/results.xml`,
        "--debug-output",
        directory,
        "--test-output-dir",
        directory,
        ".maestro/",
      ],
      { stdio: "inherit", timeout: 1200000, killSignal: "SIGKILL" },
    );
    let error;
    child.on("error", (value) => {
      error = value;
    });
    child.on("close", (code, signal) =>
      resolve({ status: code, signal, error }),
    );
  });
  status = result.status ?? 1;
  evidence.steps.push({
    phase: "maestro",
    elapsedMs: Math.round(performance.now() - start),
    ...outcome(result),
  });
  evidence.transport = await monitor.stop();
  // Missing diagnostics must not turn an unexplained flaky run into acceptance.
  if (status === 0 && !evidence.transport.complete) status = 1;
  snapshot("after-maestro");
}
evidence.exitCode = status;
writeFileSync(
  `${directory}/diagnostics-${runId}-${attempt}.json`,
  JSON.stringify(evidence, null, 2) + "\n",
  { flag: "wx" },
);
process.exitCode = status;
