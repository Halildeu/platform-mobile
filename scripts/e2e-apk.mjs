import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [mode, directory, commit, architecture = "x86_64"] =
  process.argv.slice(2);
assert.ok(mode === "seal" || mode === "verify", "Expected seal or verify");
assert.ok(directory, "Artifact directory is required");
assert.ok(
  ["x86_64", "arm64-v8a"].includes(architecture),
  "Unsupported APK architecture",
);
assert.match(
  commit ?? "",
  /^[a-f0-9]{40}$/,
  "Exact checkout commit is required",
);

// Fixed filename avoids accepting a manifest-selected path outside the artifact.
const apk = readFileSync(join(directory, "app-release.apk"));
assert.ok(apk.length > 0, "APK must not be empty");
// Inspect the ZIP directory without extracting or trusting the manifest's ABI.
const entries = execFileSync(
  "unzip",
  ["-Z1", resolve(directory, "app-release.apk")],
  {
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 4 * 1024 * 1024,
  },
);
const abis = [
  ...new Set(
    entries
      .split(/\r?\n/)
      .map((entry) => /^lib\/([^/]+)\/[^/]+\.so$/.exec(entry)?.[1])
      .filter(Boolean),
  ),
].sort();
assert.deepEqual(abis, [architecture], "APK native ABI does not match target");
const expected = {
  schema: "mobile-e2e-apk/v1",
  commit,
  architecture,
  file: "app-release.apk",
  bytes: apk.length,
  sha256: createHash("sha256").update(apk).digest("hex"),
};
const manifest = join(directory, "manifest.json");
if (mode === "seal") {
  writeFileSync(manifest, `${JSON.stringify(expected, null, 2)}\n`, {
    flag: "wx",
  });
} else {
  assert.deepEqual(
    JSON.parse(readFileSync(manifest, "utf8")),
    expected,
    "APK handoff mismatch",
  );
}
console.log(
  `${mode}: commit=${commit} architecture=${architecture} bytes=${expected.bytes} sha256=${expected.sha256}`,
);
