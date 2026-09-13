import { spawn, spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import {
  setInterval,
  clearInterval,
  setTimeout,
  clearTimeout,
} from "node:timers";

// Observe the host server and target transport without persisting adb payloads.
export function monitorTransport() {
  const evidence = {
    events: [],
    droppedEvents: 0,
    hostPidSampleIntervalMs: 500,
    complete: false,
  };
  let buffer = Buffer.alloc(0);
  let stopping = false;
  let finished = false;
  let lastPids;
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
      buffer = Buffer.alloc(0);
      return;
    }
    // adb track-devices streams four hexadecimal byte-counts, then UTF-8 lists.
    while (buffer.length >= 4) {
      const header = buffer.subarray(0, 4).toString("utf8");
      if (!/^[0-9a-fA-F]{4}$/.test(header)) {
        evidence.protocolError = true;
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
    }
  });
  const closed = new Promise((resolve) => {
    tracker.on("error", (error) => {
      // OS error codes only; error messages can contain arbitrary executable paths.
      evidence.error = ["ENOENT", "EACCES", "EMFILE"].includes(error.code)
        ? error.code
        : "OTHER";
    });
    tracker.on("close", (code, signal) => {
      finished = true;
      evidence.tracker = { exitCode: code, signal, stoppedByRunner: stopping };
      resolve();
    });
  });
  const samplePids = () => {
    const result = spawnSync(
      "pgrep",
      ["-f", "(^|/)adb -L tcp:5037 fork-server server"],
      {
        encoding: "utf8",
        timeout: 1000,
        maxBuffer: 4096,
      },
    );
    const raw = result.stdout?.trim() ?? "";
    const valid =
      (result.status === 0 && /^\d+(\s+\d+)*$/.test(raw)) ||
      (result.status === 1 && raw === "");
    const pids =
      valid && raw
        ? raw
            .split(/\s+/)
            .map(Number)
            .sort((a, b) => a - b)
        : [];
    const key = JSON.stringify([result.status, pids, valid]);
    if (key !== lastPids) {
      record({
        kind: "host-adb-server",
        pids,
        probeExitCode: result.status,
        valid,
      });
      lastPids = key;
    }
  };
  samplePids();
  const interval = setInterval(samplePids, 500);
  return {
    async stop() {
      clearInterval(interval);
      samplePids();
      const endedEarly =
        finished || tracker.exitCode !== null || tracker.signalCode !== null;
      stopping = true;
      if (!finished) tracker.kill("SIGTERM");
      const kill = setTimeout(() => tracker.kill("SIGKILL"), 1000);
      await closed;
      clearTimeout(kill);
      evidence.partialFrame = buffer.length !== 0;
      evidence.complete =
        !endedEarly &&
        !evidence.error &&
        !evidence.overflow &&
        !evidence.protocolError &&
        !evidence.partialFrame &&
        evidence.droppedEvents === 0 &&
        evidence.events.some((event) => event.kind === "transport") &&
        evidence.events.some(
          (event) =>
            event.kind === "host-adb-server" &&
            event.valid &&
            event.pids.length > 0,
        ) &&
        evidence.events
          .filter((event) => event.kind === "host-adb-server")
          .every((event) => event.valid);
      return evidence;
    },
  };
}
