import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { mkdirSync, statfsSync, writeFileSync } from "node:fs";
import { cpus, freemem, loadavg, totalmem } from "node:os";

// Raw system diagnostics are limited to disposable, unauthenticated CI emulators.
// Never invoke this collector for a phone or an authenticated/FCM scenario.
export function collectEmulatorHealth(phase, directory, env = process.env) {
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
  function probe(name, args, save = false) {
    const command = spawnSync("adb", ["-s", "emulator-5554", ...args], {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 512 * 1024,
      killSignal: "SIGKILL",
    });
    const ok = command.status === 0 && !command.error;
    result.probes.push({
      name,
      ok,
      exitCode: command.status,
      error: command.error?.code ?? null,
      signal: command.signal,
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
    probe("emulator-identity", ["shell", "getprop", "ro.kernel.qemu"]) !== "1"
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
  const state = probe("transport", ["get-state"]);
  const boot = probe("boot", ["shell", "getprop", "sys.boot_completed"]);
  const packages = probe("package-manager", ["shell", "pm", "path", "android"]);
  const windows = probe(
    "windows",
    // API35 prints mCurrentFocus in DisplayContent, not the windows subcommand.
    ["shell", "dumpsys", "window", "displays"],
    true,
  );
  const focus = windows
    ?.split(/\r?\n/)
    .find((line) => /mCurrentFocus=/.test(line));
  result.ready =
    state === "device" &&
    boot === "1" &&
    packages?.startsWith("package:") === true &&
    /mCurrentFocus=Window\{/.test(focus ?? "");
  result.errorDialog = /Application (?:Not Responding|Error):/i.test(
    focus ?? "",
  );
  // Capture before Maestro can clear logcat; lastanr survives log ring rotation.
  probe(
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
  probe("last-anr", ["shell", "dumpsys", "activity", "lastanr"], true);
  probe("guest-memory", ["shell", "cat", "/proc/meminfo"], true);
  result.healthy =
    result.ready && !result.errorDialog && result.probes.every((p) => p.ok);
  return result;
}
