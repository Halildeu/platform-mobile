import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { setTimeout, clearTimeout } from "node:timers";

const knownErrors = [
  "ENOENT",
  "EACCES",
  "EMFILE",
  "ETIMEDOUT",
  "ENOBUFS",
  "CLOSE_TIMEOUT",
];

export function commandExitCode(result) {
  if (
    Number.isInteger(result.status) &&
    result.status > 0 &&
    result.status <= 255
  )
    return result.status;
  return result.status === 0 && !result.error && !result.signal ? 0 : 1;
}

// Never persist stderr: adb errors may include device IDs, command arguments or
// paths. Keep a small diagnostic vocabulary instead.
export function commandOutcome(result) {
  const code = result.error?.code;
  let failure = "none";
  if (code) failure = knownErrors.includes(code) ? code : "OTHER";
  else if (result.status !== 0 || result.signal) {
    const stderr = result.stderr ?? "";
    failure = /device offline/i.test(stderr)
      ? "device-offline"
      : /unauthorized/i.test(stderr)
        ? "device-unauthorized"
        : /no devices?\/emulators? found|device .* not found/i.test(stderr)
          ? "device-not-found"
          : /cannot connect to daemon|failed to read response|connection reset|server.*(?:died|killed)|protocol fault|connection.*closed/i.test(
                stderr,
              )
            ? "server-disconnected"
            : "command-failed";
  }
  return {
    at: result.at,
    elapsedMs: result.elapsedMs,
    exitCode: result.status,
    signal: result.signal ?? null,
    error: code ? (knownErrors.includes(code) ? code : "OTHER") : null,
    failure,
    stdoutBytes: result.stdoutBytes,
    stderrBytes: result.stderrBytes,
  };
}

// All observed commands yield to the event loop. A synchronous adb/pgrep call
// would freeze transport listeners and erase the timing of a preflight failure.
export function runCommand(
  command,
  args,
  { timeout = 5000, maxBuffer = 4096, inherit = false } = {},
) {
  const at = new Date().toISOString();
  const start = performance.now();
  return new Promise((resolve) => {
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let error;
    let done = false;
    let deadline;
    let closeDeadline;
    const child = spawn(command, args, {
      stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    const finish = (status, signal) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      clearTimeout(closeDeadline);
      resolve({
        at,
        elapsedMs: Math.round(performance.now() - start),
        status,
        signal,
        error,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        stdoutBytes,
        stderrBytes,
      });
    };
    const terminate = (code) => {
      error ??= { code };
      child.kill("SIGKILL");
      closeDeadline ??= setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish(null, "SIGKILL");
      }, 1000);
    };
    child.stdout?.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      stdout = Buffer.concat([
        stdout,
        chunk.subarray(0, Math.max(0, maxBuffer - stdout.length)),
      ]);
      if (stdoutBytes > maxBuffer) terminate("ENOBUFS");
    });
    child.stderr?.on("data", (chunk) => {
      stderrBytes += chunk.length;
      stderr = Buffer.concat([
        stderr,
        chunk.subarray(0, Math.max(0, maxBuffer - stderr.length)),
      ]);
      if (stderrBytes > maxBuffer) terminate("ENOBUFS");
    });
    child.on("error", (value) => {
      error ??= {
        code: knownErrors.includes(value.code) ? value.code : "OTHER",
      };
    });
    child.on("close", finish);
    deadline = setTimeout(() => terminate("ETIMEDOUT"), timeout);
  });
}
