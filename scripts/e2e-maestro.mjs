import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { monitorTransport } from "./e2e-maestro-transport.mjs";
import { collectEmulatorHealth } from "./e2e-maestro-emulator.mjs";
import {
  commandExitCode,
  commandOutcome,
  runCommand,
} from "./e2e-maestro-command.mjs";

const runId = process.env.GITHUB_RUN_ID;
const attempt = process.env.GITHUB_RUN_ATTEMPT;
const commit = process.env.GITHUB_SHA;
const flow = process.env.MAESTRO_FLOW;
const flowPaths = {
  "app-launch": ".maestro/flows/01-app-launch.yaml",
  "transcript-demo": ".maestro/flows/02-transcript-demo.yaml",
};
assert.ok(
  flow === undefined || Object.hasOwn(flowPaths, flow),
  "Unknown Maestro flow",
);
const collectHealth = process.env.MAESTRO_SYNTHETIC_EMULATOR === "1";
if (collectHealth) {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.ok(
    Object.hasOwn(flowPaths, flow),
    "System diagnostics require an isolated synthetic flow",
  );
}
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
  flow: flow ?? "all",
  steps: [],
};

async function snapshot(phase) {
  const at = new Date().toISOString();
  const state = await runCommand("adb", ["-s", "emulator-5554", "get-state"]);
  const boot = await runCommand("adb", [
    "-s",
    "emulator-5554",
    "shell",
    "getprop",
    "sys.boot_completed",
  ]);
  const value = state.stdout?.trim();
  // Only allowlisted state and command outcomes enter diagnostics, never raw logs.
  evidence.steps.push({
    phase,
    at,
    deviceState: ["device", "offline", "unauthorized"].includes(value)
      ? value
      : "unknown",
    stateProbe: commandOutcome(state),
    bootCompleted: boot.status === 0 && boot.stdout?.trim() === "1",
    bootProbe: commandOutcome(boot),
  });
}

async function execute(name, command, args, timeout) {
  const result = await runCommand(command, args, { inherit: true, timeout });
  evidence.steps.push({
    phase: name,
    ...commandOutcome(result),
  });
  return commandExitCode(result);
}

let status = 0;
const monitor = monitorTransport();
try {
  if (!(await monitor.ready)) status = 1;
  await snapshot("before-install");
  if (collectHealth) {
    evidence.emulator = [
      await collectEmulatorHealth("before-install", directory),
    ];
    if (!evidence.emulator[0].healthy) status = 1;
  }
  if (status === 0) {
    status = await execute(
      "install",
      "adb",
      ["-s", "emulator-5554", "install", "-r", "artifacts/apk/app-release.apk"],
      120000,
    );
    await snapshot("after-install");
  } else {
    evidence.steps.push({
      phase: "install",
      skipped: true,
      reason: "preflight-failed",
    });
    await snapshot("after-preflight");
  }
  if (status === 0) {
    status = await execute(
      "maestro",
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
        flow === undefined ? ".maestro/" : flowPaths[flow],
      ],
      1200000,
    );
    await snapshot("after-maestro");
  }
} catch {
  // Preserve any earlier install/test failure and never print exception paths.
  evidence.runnerError = "runner-or-evidence-collection-failed";
  if (status === 0) status = 1;
} finally {
  if (collectHealth) {
    try {
      const health = await collectEmulatorHealth("after-test", directory);
      (evidence.emulator ??= []).push(health);
      if (status === 0 && !health.healthy) status = 1;
    } catch {
      evidence.postflightError = "evidence-collection-failed";
      if (status === 0) status = 1;
    }
  }
  evidence.transport = await monitor.stop();
  // Missing diagnostics must not turn an unexplained flaky run into acceptance.
  if (status === 0 && !evidence.transport.complete) status = 1;
}
evidence.exitCode = status;
writeFileSync(
  `${directory}/diagnostics-${runId}-${attempt}.json`,
  JSON.stringify(evidence, null, 2) + "\n",
  { flag: "wx" },
);
process.exitCode = status;
