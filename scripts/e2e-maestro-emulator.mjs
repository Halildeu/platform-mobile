import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdirSync, statfsSync, writeFileSync } from "node:fs";
import { cpus, freemem, loadavg, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { commandOutcome, runCommand } from "./e2e-maestro-command.mjs";

function windowState(windows) {
  if (windows === null) return "probe-failed";
  const focus = windows
    .split(/\r?\n/)
    .find((line) => /mCurrentFocus=/.test(line));
  if (/Application (?:Not Responding|Error):/i.test(focus ?? ""))
    return "error-dialog";
  if (/mCurrentFocus=null/.test(focus ?? "")) return "starting";
  if (!/mCurrentFocus=Window\{/.test(focus ?? ""))
    return "invalid-window-state";
  const activeWindows = windows
    .split(/\r?\n/)
    .filter((line) =>
      /mCurrentFocus=|mFocusedApp=|mObscuringWindow=/.test(line),
    );
  return activeWindows.some((line) =>
    /com\.android\.sdksetup\/|\.FallbackHome\b/.test(line),
  )
    ? "starting"
    : "ready";
}

// Wait for setup only, never retry a test or dismiss a system failure. Clock/sleep
// injection lets regressions exercise the actual 30s deadline without waiting.
export async function waitForEmulatorWindow(
  readWindow,
  { waitForBoot = true, now = () => performance.now(), pause = delay } = {},
) {
  const start = now();
  const deadline = start + 30000;
  const checks = [];
  let windows = null;
  let consecutiveReady = 0;
  let reason = "startup-timeout";
  let ready = false;
  while (now() < deadline) {
    windows = await readWindow(
      Math.max(1, Math.ceil(Math.min(5000, deadline - now()))),
      checks.length,
    );
    const state = windowState(windows);
    checks.push({ elapsedMs: Math.round(now() - start), state });
    if (!["ready", "starting"].includes(state)) {
      reason = state;
      break;
    }
    consecutiveReady = state === "ready" ? consecutiveReady + 1 : 0;
    if (now() >= deadline) break;
    if (consecutiveReady >= (waitForBoot ? 2 : 1)) {
      ready = true;
      reason = "ready";
      break;
    }
    if (!waitForBoot) {
      reason = "not-ready";
      break;
    }
    await pause(Math.min(500, deadline - now()));
  }
  return {
    ready,
    reason,
    checks,
    elapsedMs: Math.round(now() - start),
    windows,
  };
}

// Raw system diagnostics are limited to disposable, unauthenticated CI emulators.
// Never invoke this collector for a phone or an authenticated/FCM scenario.
export async function collectEmulatorHealth(
  phase,
  directory,
  env = process.env,
) {
  assert.equal(env.GITHUB_ACTIONS, "true");
  assert.equal(env.MAESTRO_SYNTHETIC_EMULATOR, "1");
  assert.ok(["app-launch", "transcript-demo"].includes(env.MAESTRO_FLOW));
  assert.ok(["before-install", "after-test"].includes(phase));
  const result = {
    phase,
    at: new Date().toISOString(),
    healthy: false,
    probes: [],
  };
  async function probe(name, args, save = false, timeout = 5000) {
    const command = await runCommand("adb", ["-s", "emulator-5554", ...args], {
      timeout,
      maxBuffer: 512 * 1024,
    });
    const ok = command.status === 0 && !command.error;
    result.probes.push({
      name,
      ok,
      ...commandOutcome(command),
      truncated: command.error?.code === "ENOBUFS",
    });
    if (save)
      writeFileSync(
        `${directory}/emulator-${phase}-${name}.txt`,
        Buffer.from(command.stdout ?? "").subarray(0, 512 * 1024),
        { flag: "wx" },
      );
    return ok ? (command.stdout ?? "").trim() : null;
  }
  // Check the selected transport before persisting any device output.
  if (
    (await probe("emulator-identity", [
      "shell",
      "getprop",
      "ro.kernel.qemu",
    ])) !== "1"
  ) {
    result.reason = "Expected disposable emulator is unavailable";
    return result;
  }
  mkdirSync(directory, { recursive: true });
  const disk = statfsSync(directory);
  result.host = {
    cpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    freeMemoryBytes: freemem(),
    loadAverage: loadavg(),
    freeDiskBytes: disk.bavail * disk.bsize,
  };
  const state = await probe("transport", ["get-state"]);
  const boot = await probe("boot", ["shell", "getprop", "sys.boot_completed"]);
  const packages = await probe("package-manager", [
    "shell",
    "pm",
    "path",
    "android",
  ]);
  let coreReady =
    state === "device" &&
    boot === "1" &&
    packages?.startsWith("package:") === true;
  const { windows, ...readiness } = await waitForEmulatorWindow(
    (timeout, attempt) =>
      probe(
        attempt === 0 ? "windows" : `windows-readiness-${attempt}`,
        // API35 prints mCurrentFocus in DisplayContent, not the windows subcommand.
        ["shell", "dumpsys", "window", "displays"],
        attempt === 0,
        timeout,
      ),
    { waitForBoot: phase === "before-install" && coreReady },
  );
  if (readiness.checks.length > 1)
    writeFileSync(
      `${directory}/emulator-${phase}-windows-final.txt`,
      Buffer.from(windows ?? "").subarray(0, 512 * 1024),
      { flag: "wx" },
    );
  // Do not install against core-service observations made before a startup wait.
  if (phase === "before-install" && coreReady && readiness.ready) {
    const currentState = await probe("transport-ready", ["get-state"]);
    const currentBoot = await probe("boot-ready", [
      "shell",
      "getprop",
      "sys.boot_completed",
    ]);
    const currentPackages = await probe("package-manager-ready", [
      "shell",
      "pm",
      "path",
      "android",
    ]);
    coreReady =
      currentState === "device" &&
      currentBoot === "1" &&
      currentPackages?.startsWith("package:") === true;
  }
  result.readiness = readiness;
  result.ready = coreReady && readiness.ready;
  result.errorDialog = readiness.reason === "error-dialog";
  // Capture before Maestro can clear logcat; lastanr survives log ring rotation.
  await probe(
    "system-log",
    [
      "logcat",
      "-b",
      "system",
      "-b",
      "events",
      "-b",
      "crash",
      "-d",
      "-t",
      "1500",
    ],
    true,
  );
  await probe("last-anr", ["shell", "dumpsys", "activity", "lastanr"], true);
  await probe("guest-memory", ["shell", "cat", "/proc/meminfo"], true);
  result.healthy =
    result.ready && !result.errorDialog && result.probes.every((p) => p.ok);
  return result;
}
