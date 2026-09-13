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
if (args.includes('install')) process.exit(Number(process.env.INSTALL_EXIT || 0));
if (args.includes('get-state')) console.log(process.env.STATE || 'device');
if (args.includes('getprop')) console.log('1');
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
