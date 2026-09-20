import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { test } from "node:test";
import { waitForEmulatorWindow } from "./e2e-maestro-emulator.mjs";

const script = fileURLToPath(new URL("./e2e-maestro.mjs", import.meta.url));
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "maestro-runner-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const bin = join(cwd, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "adb"),
    `#!${process.execPath}
const args = process.argv.slice(2);
if (args.includes('track-devices')) {
  if (process.env.TRACKER_EXIT) process.exit(8);
  const frame = (text) => Buffer.byteLength(text).toString(16).padStart(4, '0') + text;
  const data = process.env.TRACK_OVERSIZE ? '0000'.repeat(40000) : process.env.TRACK_DATA || frame('emulator-5554\\tdevice\\n');
  process.stdout.write(data.slice(0, 2));
  setTimeout(() => process.stdout.write(data.slice(2)), 10);
  if (process.env.TRANSIENT) setTimeout(() => {
    process.stdout.write(frame('emulator-5554\\toffline\\n') + frame('') + frame('emulator-5554\\tdevice\\n'));
  }, 30);
  setInterval(() => {}, 1000);
}
if (args.includes('disable-user')) { require('node:fs').writeFileSync('disabled.json', JSON.stringify(args)); process.exit(Number(process.env.DISABLE_EXIT || 0)); }
if (args.includes('install')) { require('node:fs').writeFileSync('installed.json', JSON.stringify(args)); process.exit(Number(process.env.INSTALL_EXIT || 0)); }
if (args.includes('get-state')) {
  const fs = require('node:fs');
  const ready = fs.existsSync('window-count') && Number(fs.readFileSync('window-count', 'utf8')) >= 2;
  console.log(process.env.LOST_AFTER_READY && ready ? 'offline' : process.env.STATE || 'device');
}
if (args.includes('getprop')) console.log(args.includes('ro.kernel.qemu') ? process.env.QEMU || '1' : '1');
if (args.includes('path')) { if (process.env.PACKAGE_PROBE_EXIT) process.exit(9); console.log('package:/system/framework/framework-res.apk'); }
if (args.includes('displays')) {
  const post = require('node:fs').existsSync('invoked.json');
  if (process.env.WINDOW_PROBE_EXIT || (post && process.env.POST_PROBE_EXIT)) process.exit(9);
  const fs = require('node:fs');
  const count = fs.existsSync('window-count') ? Number(fs.readFileSync('window-count', 'utf8')) : 0;
  fs.writeFileSync('window-count', String(count + 1));
  if ((process.env.STARTING_WINDOWS && count < 2) || (post && process.env.POST_NOT_READY)) {
    console.log('mCurrentFocus=null\\nmFocusedApp=ActivityRecord{918ab0d u0 com.android.sdksetup/.DefaultActivity t6}\\nmObscuringWindow=Window{9e4e1e2 u0 com.android.settings/com.android.settings.FallbackHome}');
    process.exit(0);
  }
  const error = process.env.ERROR_DIALOG || (post && process.env.POST_DIALOG);
  console.log('mCurrentFocus=Window{123 u0 ' + (error ? 'Application Not Responding: com.android.launcher3' : 'com.android.launcher3/.Launcher') + '}');
}
if (args.includes('lastanr')) console.log('SYNTHETIC_ANR_TRACE');
if (args.includes('logcat')) console.log(process.env.LOG_OVERSIZE ? 'x'.repeat(2 * 1024 * 1024) : 'SYNTHETIC_BOOT_LOG');
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, "maestro"),
    `#!${process.execPath}
require('node:fs').writeFileSync('invoked.json', JSON.stringify(process.argv.slice(2)));
if (process.env.TRANSIENT) require('node:fs').writeFileSync('pid-changed', '1');
setTimeout(() => {
  if (process.env.SIGNAL) process.kill(process.pid, 'SIGTERM');
  else process.exit(Number(process.env.MAESTRO_EXIT || 0));
}, 250);
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, "pgrep"),
    `#!${process.execPath}\nconsole.log(process.env.PID_RAW || (require('node:fs').existsSync('pid-changed') ? '23456' : '12345'));\n`,
    { mode: 0o755 },
  );
  return { cwd, bin };
}
function run(f, env = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: f.cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: f.bin,
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "2",
      GITHUB_SHA: "a".repeat(40),
      ...env,
    },
  });
}
function evidence(f) {
  return JSON.parse(
    readFileSync(join(f.cwd, "artifacts/maestro/diagnostics-123-2.json")),
  );
}
test("success preserves both flows, identity and three lifecycle probes", (t) => {
  const f = fixture(t);
  assert.equal(run(f).status, 0);
  const result = evidence(f);
  assert.equal(result.commit, "a".repeat(40));
  assert.equal(result.attempt, "2");
  assert.equal(result.exitCode, 0);
  assert.equal(result.transport.complete, true);
  assert.deepEqual(
    result.steps.map((s) => s.phase),
    ["before-install", "install", "after-install", "maestro", "after-maestro"],
  );
  assert.ok(
    result.steps
      .filter((s) => s.stateProbe)
      .every((s) => s.deviceState === "device" && s.bootCompleted),
  );
  const args = JSON.parse(readFileSync(join(f.cwd, "invoked.json")));
  assert.equal(args.at(-1), ".maestro/");
  assert.ok(!args.includes("--retry"));
});
test("install failure keeps evidence and never invokes Maestro", (t) => {
  const f = fixture(t);
  assert.equal(run(f, { INSTALL_EXIT: "7" }).status, 7);
  assert.equal(evidence(f).exitCode, 7);
  assert.ok(!existsSync(join(f.cwd, "invoked.json")));
});

test("isolated flows select exactly one scenario and preserve failures", (t) => {
  for (const [flow, path] of [
    ["app-launch", ".maestro/flows/01-app-launch.yaml"],
    ["transcript-demo", ".maestro/flows/02-transcript-demo.yaml"],
  ]) {
    const f = fixture(t);
    assert.equal(run(f, { MAESTRO_FLOW: flow, MAESTRO_EXIT: "3" }).status, 3);
    assert.equal(evidence(f).flow, flow);
    const args = JSON.parse(readFileSync(join(f.cwd, "invoked.json")));
    assert.equal(args.at(-1), path);
    assert.ok(!args.includes("--retry"));
  }
});

test("unknown flow is rejected before device commands", (t) => {
  const f = fixture(t);
  assert.notEqual(run(f, { MAESTRO_FLOW: "../skip-tests" }).status, 0);
  assert.ok(!existsSync(join(f.cwd, "invoked.json")));
  assert.ok(!existsSync(join(f.cwd, "artifacts")));
});
test("Maestro failure is not hidden by successful diagnostics", (t) => {
  const f = fixture(t);
  assert.equal(run(f, { MAESTRO_EXIT: "3" }).status, 3);
  assert.equal(evidence(f).exitCode, 3);
  assert.equal(evidence(f).steps.at(-1).phase, "after-maestro");
});
test("signal termination fails closed and still records final probes", (t) => {
  const f = fixture(t);
  assert.equal(run(f, { SIGNAL: "1" }).status, 1);
  assert.equal(
    evidence(f).steps.find((s) => s.phase === "maestro").signal,
    "SIGTERM",
  );
});
test("raw device output is not copied to diagnostics", (t) => {
  const f = fixture(t);
  assert.equal(run(f, { STATE: "SENSITIVE_TEST_MARKER" }).status, 0);
  const data = JSON.stringify(evidence(f));
  assert.ok(!data.includes("SENSITIVE_TEST_MARKER"));
  assert.equal(evidence(f).steps[0].deviceState, "unknown");
});
test("invalid attempt fails before running commands", (t) => {
  const f = fixture(t);
  assert.notEqual(run(f, { GITHUB_RUN_ATTEMPT: "../other" }).status, 0);
  assert.ok(!existsSync(join(f.cwd, "invoked.json")));
});
test("missing executable fails closed with bounded probe outcomes", (t) => {
  const f = fixture(t);
  assert.equal(run(f, { PATH: "/nonexistent-maestro-test-bin" }).status, 1);
  assert.equal(evidence(f).steps[0].stateProbe.error, "ENOENT");
  assert.equal(evidence(f).exitCode, 1);
});
test("attempts retain separate evidence and never overwrite same-attempt evidence", (t) => {
  const f = fixture(t);
  assert.equal(run(f).status, 0);
  const original = readFileSync(
    join(f.cwd, "artifacts/maestro/diagnostics-123-2.json"),
    "utf8",
  );
  assert.equal(run(f, { GITHUB_RUN_ATTEMPT: "3" }).status, 0);
  assert.ok(
    existsSync(join(f.cwd, "artifacts/maestro/diagnostics-123-3.json")),
  );
  assert.notEqual(run(f).status, 0);
  assert.equal(
    readFileSync(
      join(f.cwd, "artifacts/maestro/diagnostics-123-2.json"),
      "utf8",
    ),
    original,
  );
});

test("records transient transport loss and server PID change within the flow", (t) => {
  const f = fixture(t);
  assert.equal(run(f, { TRANSIENT: "1" }).status, 0);
  const events = evidence(f).transport.events;
  assert.deepEqual(
    events.filter((e) => e.kind === "transport").map((e) => e.state),
    ["device", "offline", "absent", "device"],
  );
  assert.deepEqual(
    events.filter((e) => e.kind === "host-adb-server").map((e) => e.pids),
    [[12345], [23456]],
  );
});
test("tracker early exit is explicit and cannot produce a successful run", (t) => {
  const f = fixture(t);
  assert.equal(run(f, { TRACKER_EXIT: "1" }).status, 1);
  assert.equal(evidence(f).transport.complete, false);
  assert.equal(evidence(f).transport.tracker.exitCode, 8);
  assert.equal(evidence(f).transport.tracker.stoppedByRunner, false);
});
test("malformed, incomplete and oversized streams fail closed without raw output", (t) => {
  for (const env of [
    { TRACK_DATA: "PRIVATE_MARKER" },
    { TRACK_DATA: "ffffPRIVATE_MARKER" },
    { TRACK_OVERSIZE: "1" },
  ]) {
    const f = fixture(t);
    assert.equal(run(f, env).status, 1);
    const transport = evidence(f).transport;
    assert.equal(transport.complete, false);
    assert.ok(!JSON.stringify(transport).includes("PRIVATE_MARKER"));
  }
});
test("foreign serials, unknown states and malformed PID output are never recorded raw", (t) => {
  const f = fixture(t);
  const payload = "PRIVATE_SERIAL\tdevice\nemulator-5554\tPRIVATE_STATE\n";
  const data =
    Buffer.byteLength(payload).toString(16).padStart(4, "0") + payload;
  assert.equal(run(f, { TRACK_DATA: data, PID_RAW: "PRIVATE_PID" }).status, 1);
  const transport = evidence(f).transport;
  assert.ok(!JSON.stringify(transport).includes("PRIVATE_"));
  assert.equal(
    transport.events.find((e) => e.kind === "transport").state,
    "unknown",
  );
});

test("missing Maestro closes the monitor and preserves executable error", (t) => {
  const f = fixture(t);
  rmSync(join(f.bin, "maestro"));
  assert.equal(run(f).status, 1);
  const result = evidence(f);
  assert.equal(result.steps.find((s) => s.phase === "maestro").error, "ENOENT");
  assert.equal(result.transport.tracker.stoppedByRunner, true);
});

const synthetic = {
  GITHUB_ACTIONS: "true",
  MAESTRO_SYNTHETIC_EMULATOR: "1",
  MAESTRO_FLOW: "app-launch",
};

test("AOSP preflight captures pre-Maestro logs without disabling packages", (t) => {
  const f = fixture(t);
  assert.equal(run(f, synthetic).status, 0);
  assert.equal(existsSync(join(f.cwd, "disabled.json")), false);
  assert.deepEqual(
    evidence(f).emulator.map((h) => h.healthy),
    [true, true],
  );
  assert.match(
    readFileSync(
      join(f.cwd, "artifacts/maestro/emulator-before-install-system-log.txt"),
      "utf8",
    ),
    /SYNTHETIC_BOOT_LOG/,
  );
  assert.match(
    readFileSync(
      join(f.cwd, "artifacts/maestro/emulator-after-test-last-anr.txt"),
      "utf8",
    ),
    /SYNTHETIC_ANR_TRACE/,
  );
  assert.equal(evidence(f).exitCode, 0);
  assert.ok(existsSync(join(f.cwd, "invoked.json")));
});

test("unhealthy emulator or focused ANR fails before Maestro and retains postflight", (t) => {
  for (const env of [
    { PACKAGE_PROBE_EXIT: "1" },
    { WINDOW_PROBE_EXIT: "1" },
    { STATE: "offline" },
    { ERROR_DIALOG: "1" },
  ]) {
    const f = fixture(t);
    assert.notEqual(run(f, { ...synthetic, ...env }).status, 0);
    assert.notEqual(evidence(f).exitCode, 0);
    assert.equal(evidence(f).emulator.length, 2);
    assert.equal(evidence(f).emulator[0].healthy, false);
    assert.equal(evidence(f).emulator[0].readiness.checks.length, 1);
    assert.equal(existsSync(join(f.cwd, "installed.json")), false);
    assert.equal(existsSync(join(f.cwd, "invoked.json")), false);
  }
});

test("postflight health cannot hide a flow failure or wait away a later problem", (t) => {
  for (const env of [
    { POST_DIALOG: "1" },
    { POST_PROBE_EXIT: "1" },
    { POST_NOT_READY: "1" },
  ]) {
    const f = fixture(t);
    assert.equal(run(f, { ...synthetic, ...env }).status, 1);
    assert.equal(evidence(f).emulator[0].healthy, true);
    assert.equal(evidence(f).emulator[1].healthy, false);
    assert.equal(evidence(f).emulator[1].readiness.checks.length, 1);
    assert.ok(existsSync(join(f.cwd, "invoked.json")));
  }
  const f = fixture(t);
  assert.equal(
    run(f, { ...synthetic, MAESTRO_EXIT: "3", POST_DIALOG: "1" }).status,
    3,
  );
  assert.equal(evidence(f).exitCode, 3);
});

test("boot-completed with SDK setup focus waits before install and preserves first evidence", (t) => {
  const f = fixture(t);
  assert.equal(run(f, { ...synthetic, STARTING_WINDOWS: "1" }).status, 0);
  const before = evidence(f).emulator[0];
  assert.deepEqual(
    before.readiness.checks.map((c) => c.state),
    ["starting", "starting", "ready", "ready"],
  );
  assert.equal(before.healthy, true);
  const artifacts = join(f.cwd, "artifacts/maestro");
  assert.match(
    readFileSync(
      join(artifacts, "emulator-before-install-windows.txt"),
      "utf8",
    ),
    /mCurrentFocus=null/,
  );
  assert.match(
    readFileSync(
      join(artifacts, "emulator-before-install-windows-final.txt"),
      "utf8",
    ),
    /com.android.launcher3\/\.Launcher/,
  );
  assert.ok(existsSync(join(f.cwd, "installed.json")));
  assert.ok(existsSync(join(f.cwd, "invoked.json")));
});

const launcher = "mCurrentFocus=Window{123 u0 com.android.launcher3/.Launcher}";
test("core transport is checked again after UI readiness before installation", (t) => {
  const f = fixture(t);
  assert.equal(run(f, { ...synthetic, LOST_AFTER_READY: "1" }).status, 1);
  const before = evidence(f).emulator[0];
  assert.equal(before.readiness.ready, true);
  assert.equal(before.ready, false);
  assert.equal(before.healthy, false);
  assert.ok(before.probes.some((p) => p.name === "transport-ready"));
  assert.equal(existsSync(join(f.cwd, "installed.json")), false);
  assert.equal(existsSync(join(f.cwd, "invoked.json")), false);
});
const setup = "mCurrentFocus=Window{123 u0 com.android.settings/.FallbackHome}";
function windowWait(sequence, options = {}) {
  let elapsed = 0;
  let calls = 0;
  const timeouts = [];
  const result = waitForEmulatorWindow(
    (timeout) => {
      timeouts.push(timeout);
      elapsed += Math.min(options.probeMs ?? 100, timeout);
      return sequence[Math.min(calls++, sequence.length - 1)];
    },
    {
      now: () => elapsed,
      pause: async (ms) => {
        elapsed += ms;
      },
      ...options,
    },
  );
  return { result, timeouts };
}

test("UI readiness deadline includes probe time and bounds the final command", async () => {
  const wait = windowWait([setup], { probeMs: 5000 });
  const result = await wait.result;
  assert.equal(result.ready, false);
  assert.equal(result.reason, "startup-timeout");
  assert.equal(result.elapsedMs, 30000);
  assert.equal(wait.timeouts.at(-1), 2500);
  assert.equal(wait.timeouts.length, 6);
});

test("a setup transition resets consecutive ready samples", async () => {
  const result = await windowWait([launcher, setup, launcher, launcher]).result;
  assert.equal(result.ready, true);
  assert.deepEqual(
    result.checks.map((c) => c.state),
    ["ready", "starting", "ready", "ready"],
  );
});

test("waiting stops immediately on a failed probe, malformed focus or ANR", async () => {
  for (const [windows, reason] of [
    [null, "probe-failed"],
    ["unexpected output", "invalid-window-state"],
    [
      "mCurrentFocus=Window{123 u0 Application Not Responding: com.android.launcher3}",
      "error-dialog",
    ],
  ]) {
    const result = await windowWait([setup, windows, launcher]).result;
    assert.equal(result.ready, false);
    assert.equal(result.reason, reason);
    assert.equal(result.checks.length, 2);
  }
});

test("postflight never waits for SDK setup to finish", async () => {
  const result = await windowWait([setup, launcher], { waitForBoot: false })
    .result;
  assert.equal(result.ready, false);
  assert.equal(result.reason, "not-ready");
  assert.equal(result.checks.length, 1);
});

test("system capture refuses non-CI, unscoped flows and non-emulator transports", (t) => {
  for (const env of [
    { GITHUB_ACTIONS: "false" },
    { MAESTRO_FLOW: "live-test" },
  ]) {
    const f = fixture(t);
    assert.notEqual(run(f, { ...synthetic, ...env }).status, 0);
    assert.equal(existsSync(join(f.cwd, "artifacts")), false);
  }
  const f = fixture(t);
  assert.equal(run(f, { ...synthetic, QEMU: "0" }).status, 1);
  assert.equal(
    existsSync(
      join(f.cwd, "artifacts/maestro/emulator-before-install-system-log.txt"),
    ),
    false,
  );
  assert.equal(existsSync(join(f.cwd, "invoked.json")), false);
});

test("oversized system log is bounded and cannot produce healthy acceptance", (t) => {
  const f = fixture(t);
  assert.equal(run(f, { ...synthetic, LOG_OVERSIZE: "1" }).status, 1);
  const result = evidence(f).emulator[0];
  assert.equal(result.healthy, false);
  assert.equal(
    result.probes.find((p) => p.name === "system-log").truncated,
    true,
  );
  assert.ok(
    readFileSync(
      join(f.cwd, "artifacts/maestro/emulator-before-install-system-log.txt"),
    ).length <=
      512 * 1024,
  );
  assert.equal(existsSync(join(f.cwd, "invoked.json")), false);
});
