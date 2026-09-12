import assert from "node:assert/strict";
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
if (process.env.SIGNAL) process.kill(process.pid, 'SIGTERM');
else process.exit(Number(process.env.MAESTRO_EXIT || 0));
`,
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
      PATH: `${f.bin}:${process.env.PATH}`,
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
