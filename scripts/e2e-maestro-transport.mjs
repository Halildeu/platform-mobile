import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";
import { setTimeout, clearTimeout } from "node:timers";
import { commandOutcome, runCommand } from "./e2e-maestro-command.mjs";

export const emulatorProcessPattern =
  "(^|/)(emulator|qemu-system-(x86_64|aarch64)(-headless)?)([[:space:]].*)?[[:space:]]-port[[:space:]]+5554([[:space:]]|$)";

// Observe the host server and target transport without persisting adb payloads.
export function monitorTransport() {
  const started = performance.now();
  const evidence = {
    startedAt: new Date().toISOString(),
    events: [],
    droppedEvents: 0,
    hostPidSampleIntervalMs: 500,
    maxAllowedSampleGapMs: 2500,
    maxSampleGapMs: 0,
    maxPidProbeDurationMs: 0,
    pidSampleRounds: 0,
    complete: false,
  };
  let buffer = Buffer.alloc(0);
  let stopping = false;
  let trackerStopRequested = false;
  let finished = false;
  const lastPids = new Map();
  let lastSample = started;
  let initialPidsReady = false;
  let deviceObserved = false;
  let readyTimer;
  let readyResolved = false;
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const settleReady = (value) => {
    if (readyResolved) return;
    readyResolved = true;
    clearTimeout(readyTimer);
    evidence.startupReady = value;
    resolveReady(value);
  };
  const checkReady = () => {
    if (initialPidsReady && deviceObserved) settleReady(true);
  };
  const record = (event) => {
    if (evidence.events.length < 4096) {
      evidence.events.push({ at: new Date().toISOString(), ...event });
    } else evidence.droppedEvents++;
  };
  const tracker = spawn("adb", ["track-devices"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  tracker.stdout.on("data", (chunk) => {
    if (evidence.protocolError || evidence.overflow) return;
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 131072) {
      evidence.overflow = true;
      settleReady(false);
      buffer = Buffer.alloc(0);
      return;
    }
    // adb track-devices streams four hexadecimal byte-counts, then UTF-8 lists.
    while (buffer.length >= 4) {
      const header = buffer.subarray(0, 4).toString("utf8");
      if (!/^[0-9a-fA-F]{4}$/.test(header)) {
        evidence.protocolError = true;
        settleReady(false);
        buffer = Buffer.alloc(0);
        return;
      }
      const length = Number.parseInt(header, 16);
      if (buffer.length < 4 + length) break;
      const frame = buffer.subarray(4, 4 + length).toString("utf8");
      buffer = buffer.subarray(4 + length);
      const row = frame
        .split("\n")
        .find((line) => line.startsWith("emulator-5554\t"));
      const state = row?.split("\t")[1]?.trim();
      record({
        kind: "transport",
        state: !row
          ? "absent"
          : ["device", "offline", "unauthorized"].includes(state)
            ? state
            : "unknown",
      });
      if (state === "device") deviceObserved = true;
      checkReady();
    }
  });
  const closed = new Promise((resolve) => {
    tracker.on("error", (error) => {
      // OS error codes only; error messages can contain arbitrary executable paths.
      evidence.error = ["ENOENT", "EACCES", "EMFILE"].includes(error.code)
        ? error.code
        : "OTHER";
      settleReady(false);
    });
    tracker.on("close", (code, signal) => {
      finished = true;
      evidence.tracker = {
        exitCode: code,
        signal,
        stoppedByRunner: trackerStopRequested,
      };
      settleReady(false);
      resolve();
    });
  });
  const processPatterns = [
    ["host-adb-server", "(^|/)adb -L tcp:5037 fork-server server"],
    // The isolated runner starts emulator/qemu with '-port 5554'. Match the
    // executable and that port, not unrelated emulator/adb commands or phones.
    ["host-emulator", emulatorProcessPattern],
  ];
  const sampleProcess = async ([kind, pattern]) => {
    const result = await runCommand("pgrep", ["-f", pattern], {
      timeout: 1000,
    });
    const raw = result.stdout?.trim() ?? "";
    const valid =
      !result.error &&
      !result.signal &&
      ((result.status === 0 && /^\d+(\s+\d+)*$/.test(raw)) ||
        (result.status === 1 && raw === ""));
    const pids =
      valid && raw
        ? raw
            .split(/\s+/)
            .map(Number)
            .sort((a, b) => a - b)
        : [];
    const key = JSON.stringify([result.status, pids, valid]);
    evidence.maxPidProbeDurationMs = Math.max(
      evidence.maxPidProbeDurationMs,
      result.elapsedMs,
    );
    if (key !== lastPids.get(kind)) {
      record({
        kind,
        pids,
        probeExitCode: result.status,
        valid,
        probe: commandOutcome(result),
      });
      lastPids.set(kind, key);
    }
    return valid && pids.length > 0;
  };
  const samplePids = async () => {
    const now = performance.now();
    evidence.maxSampleGapMs = Math.max(
      evidence.maxSampleGapMs,
      Math.round(now - lastSample),
    );
    lastSample = now;
    const values = await Promise.all(processPatterns.map(sampleProcess));
    evidence.pidSampleRounds++;
    if (evidence.pidSampleRounds === 1)
      initialPidsReady = values.every(Boolean);
    if (!initialPidsReady) settleReady(false);
    checkReady();
  };
  let nextSample;
  let inFlight;
  const round = () => {
    inFlight = samplePids().finally(() => {
      if (!stopping) nextSample = setTimeout(round, 500);
    });
  };
  readyTimer = setTimeout(() => settleReady(false), 5000);
  round();
  return {
    ready,
    async stop() {
      stopping = true;
      clearTimeout(nextSample);
      settleReady(false);
      await inFlight;
      await samplePids();
      const endedEarly =
        finished || tracker.exitCode !== null || tracker.signalCode !== null;
      if (!finished) {
        trackerStopRequested = true;
        tracker.kill("SIGTERM");
      }
      const kill = setTimeout(() => tracker.kill("SIGKILL"), 1000);
      let closeTimer;
      await Promise.race([
        closed,
        new Promise((resolve) => {
          closeTimer = setTimeout(() => {
            evidence.shutdownTimeout = true;
            tracker.kill("SIGKILL");
            tracker.stdout.destroy();
            tracker.unref();
            resolve();
          }, 2000);
        }),
      ]);
      clearTimeout(kill);
      clearTimeout(closeTimer);
      evidence.endedAt = new Date().toISOString();
      evidence.elapsedMs = Math.round(performance.now() - started);
      evidence.partialFrame = buffer.length !== 0;
      evidence.complete =
        evidence.startupReady &&
        !endedEarly &&
        !evidence.shutdownTimeout &&
        evidence.maxSampleGapMs <= evidence.maxAllowedSampleGapMs &&
        !evidence.error &&
        !evidence.overflow &&
        !evidence.protocolError &&
        !evidence.partialFrame &&
        evidence.droppedEvents === 0 &&
        evidence.events.some((event) => event.kind === "transport") &&
        initialPidsReady &&
        evidence.events
          .filter(
            (event) =>
              event.kind === "host-adb-server" ||
              event.kind === "host-emulator",
          )
          .every((event) => event.valid);
      return evidence;
    },
  };
}
