import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [mode, directory, commit] = process.argv.slice(2);
assert.ok(mode === "seal" || mode === "verify", "Expected seal or verify");
assert.ok(directory, "Artifact directory is required");
assert.match(
  commit ?? "",
  /^[a-f0-9]{40}$/,
  "Exact checkout commit is required",
);

// Fixed filename avoids accepting a manifest-selected path outside the artifact.
const apk = readFileSync(join(directory, "app-release.apk"));
assert.ok(apk.length > 0, "APK must not be empty");
const expected = {
  schema: "mobile-e2e-apk/v1",
  commit,
  architecture: "x86_64",
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
  `${mode}: commit=${commit} bytes=${expected.bytes} sha256=${expected.sha256}`,
);
