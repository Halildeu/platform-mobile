import { existsSync, mkdirSync, openSync, closeSync, fsyncSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { APP_ID, EAS_VERSION, PROJECT_ID, command, jsonCommand, requireValue, resolvedConfig, verifyCli } from './release-common.mjs';
import { buildArgs, buildIdFromOutput, inspectBuild, inspectSubmission, materializeSubmitConfig, packageConfig, submissionIdFromOutput, submitArgs, validatePackageInput } from './package-plan.mjs';
import { downloadArchive, readBuild, readSubmission, waitForPackage } from './package-remote.mjs';

export async function runPackage(input, deps, execute = false) {
  validatePackageInput(input);
  let receipt = { schemaVersion: 1, projectId: PROJECT_ID, applicationId: APP_ID, cliVersion: EAS_VERSION,
    operation: input.operation, platform: input.platform, channel: input.channel, ota: input.ota,
    sourceCommit: input.sha, buildId: input.buildId || null, submissionId: input.submissionId || null,
    phase: 'prepared' };
  const record = async changes => {
    receipt = { ...receipt, ...changes, at: new Date().toISOString() };
    await deps.record(receipt);
  };
  await record({});
  if (input.operation === 'build') {
    let buildId = input.buildId;
    if (!buildId) {
      const before = await deps.config(); packageConfig(input, before);
      if (!execute) return receipt;
      const again = await deps.config(); packageConfig(input, again);
      requireValue(JSON.stringify(before) === JSON.stringify(again), 'Build configuration changed before creation');
      await record({ phase: 'creation-outcome-unknown' });
      const output = await deps.mutate(buildArgs(input));
      buildId = buildIdFromOutput(output);
      // Persist identity before any subsequent network call, including validation.
      await record({ phase: 'build-created', buildId });
    }
    const bound = { ...input, buildId };
    const build = await deps.wait(() => deps.build(buildId), (value, finished) => inspectBuild(value, bound, finished));
    const proof = inspectBuild(build, bound);
    const archive = await deps.archive(build);
    await record({ phase: 'build-verified', build: proof, archive });
    return receipt;
  }

  const build = await deps.build(input.buildId);
  const proof = inspectBuild(build, input);
  const archive = await deps.archive(build);
  requireValue(archive.sha256 === input.digest, 'Archive SHA256 differs from the accepted build receipt');
  await record({ build: proof, archive });
  let submissionId = input.submissionId;
  if (!submissionId) {
    // A pre-existing submission must be inspected explicitly, never sent again.
    requireValue(Array.isArray(build.submissions) && build.submissions.length === 0, 'This build already has a submission; resume by its exact ID');
    await deps.submitConfig();
    if (!execute) return receipt;
    const again = await deps.build(input.buildId);
    requireValue(JSON.stringify(inspectBuild(again, input)) === JSON.stringify(proof) && Array.isArray(again.submissions) && again.submissions.length === 0, 'Build/submission state changed before sending');
    const finalArchive = await deps.archive(again, 'final-submit');
    requireValue(finalArchive.sha256 === input.digest, 'Archive changed before submission');
    await deps.submitConfig();
    await record({ phase: 'creation-outcome-unknown' });
    const output = await deps.mutate(submitArgs(input));
    submissionId = submissionIdFromOutput(output);
    await record({ phase: 'submission-created', submissionId });
  }
  const bound = { ...input, submissionId };
  const submission = await deps.wait(() => deps.submission(submissionId), (value, finished) => inspectSubmission(value, bound, finished));
  await record({ phase: 'submission-verified', submission: inspectSubmission(submission, bound),
    acceptance: 'EAS upload completed; store processing, tester access and physical-device acceptance are separate.' });
  return receipt;
}

function writeReceipt(file, receipt) {
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify(receipt, null, 2), { mode: 0o600 });
  const handle = openSync(temporary, 'r');
  try { fsyncSync(handle); } finally { closeSync(handle); }
  renameSync(temporary, file);
}

export async function withSubmitConfig(input, path, action) {
  const original = readFileSync(path);
  const configured = JSON.stringify(materializeSubmitConfig(input, JSON.parse(original.toString('utf8'))), null, 2) + '\n';
  writeFileSync(path, configured);
  try { return await action(); }
  finally {
    requireValue(readFileSync(path, 'utf8') === configured, 'Temporary submit configuration changed unexpectedly; refusing to overwrite it');
    writeFileSync(path, original);
  }
}

export async function validateResolvedSubmit(input, eas, api) {
  const configured = materializeSubmitConfig(input, eas);
  const accessor = api.EasJsonAccessor.fromRawString(JSON.stringify(configured));
  const profile = await api.EasJsonUtils.getSubmitProfileAsync(accessor, input.platform, 'internal');
  if (input.platform === 'ios') requireValue(profile.ascAppId === input.ascAppId && profile.bundleIdentifier === APP_ID, 'Resolved ASC submit destination mismatch');
  else requireValue(profile.applicationId === APP_ID && profile.track === 'internal' && profile.releaseStatus === 'completed', 'Resolved Play submit destination mismatch');
}

async function main() {
  const intentPath = 'release-intent.json';
  if (process.argv.includes('--intent')) {
    const operation = process.env.PACKAGE_OPERATION;
    const buildId = process.env.PACKAGE_BUILD_ID || '';
    const suppliedSha = process.env.PACKAGE_SOURCE_COMMIT || '';
    requireValue(operation !== 'build' || buildId || !suppliedSha || suppliedSha === process.env.GITHUB_SHA, 'New builds use the workflow checkout SHA');
    const input = { operation, platform: process.env.PACKAGE_PLATFORM, channel: process.env.PACKAGE_CHANNEL,
      ota: process.env.PACKAGE_OTA === 'true', buildId, submissionId: process.env.PACKAGE_SUBMISSION_ID || '',
      sha: operation === 'build' && !buildId ? process.env.GITHUB_SHA : suppliedSha,
      digest: process.env.PACKAGE_ARCHIVE_SHA256 || '', ascAppId: process.env.MOBILE_ASC_APP_ID || '' };
    requireValue(['true', 'false'].includes(process.env.PACKAGE_OTA), 'Explicit OTA choice is required');
    validatePackageInput(input);
    writeFileSync(intentPath, JSON.stringify(input), { flag: 'wx', mode: 0o600 });
    return;
  }
  const execute = process.argv.includes('--execute');
  const input = JSON.parse(readFileSync(intentPath, 'utf8')); validatePackageInput(input);
  requireValue(process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REPOSITORY === 'Halildeu/platform-mobile' && process.env.GITHUB_REF === 'refs/heads/main' && process.platform === 'linux', 'Use the main-branch package workflow');
  const resume = input.operation === 'build' ? !!input.buildId : !!input.submissionId;
  if (execute && !resume) requireValue(process.env.GITHUB_RUN_ATTEMPT === '1', 'A workflow rerun cannot repeat package creation');
  requireValue(command('git', ['rev-parse', 'HEAD']) === process.env.GITHUB_SHA && command('git', ['status', '--porcelain']) === '', 'Package tooling checkout changed or is dirty');
  if (input.operation === 'build' && !resume) requireValue(input.sha === process.env.GITHUB_SHA, 'New package source mismatch');
  for (const key of ['EAS_NO_VCS', 'EAS_PROJECT_ROOT', 'EAS_BUILD_GIT_COMMIT_HASH', 'EXPO_APPLE_APP_SPECIFIC_PASSWORD']) requireValue(!process.env[key], 'Unsupported release environment override');
  verifyCli();
  process.env.MOBILE_OTA_ENABLED = input.ota ? '1' : '0';
  if (input.platform === 'ios') process.env.MOBILE_ASC_APP_ID = input.ascAppId;
  const local = resolvedConfig();
  requireValue(local.extra?.eas?.projectId === PROJECT_ID && local.android?.package === APP_ID && local.ios?.bundleIdentifier === APP_ID, 'Local submission project/application mismatch');
  const { profile, simulator } = validatePackageInput(input);
  const evidence = 'release-evidence'; mkdirSync(evidence, { recursive: true });
  const receiptPath = `${evidence}/package.json`;
  requireValue(!existsSync(receiptPath), 'Package receipt already exists; inspect before another operation');
  let submitApi;
  if (input.operation === 'submit') {
    const cliRequire = createRequire(resolve(command('npm', ['root', '--global']), 'eas-cli/package.json'));
    requireValue(cliRequire('./package.json').version === EAS_VERSION, 'Submit resolver version mismatch');
    submitApi = cliRequire('@expo/eas-json');
  }
  const deps = {
    config: async () => jsonCommand('eas', ['config', '--platform', input.platform, '--profile', profile, '--json', '--non-interactive'], 120000),
    submitConfig: async () => validateResolvedSubmit(input, JSON.parse(readFileSync('eas.json', 'utf8')), submitApi),
    build: readBuild, submission: readSubmission, wait: waitForPackage,
    archive: async (build, stage = 'application') => {
      const file = `${stage}.${simulator ? 'tar.gz' : input.platform === 'ios' ? 'ipa' : input.channel === 'production' ? 'aab' : 'apk'}`;
      return { ...await downloadArchive(build.artifacts.applicationArchiveUrl, `${evidence}/${file}`), file };
    },
    record: async receipt => writeReceipt(receiptPath, receipt),
    mutate: async args => input.operation === 'submit'
      ? withSubmitConfig(input, 'eas.json', async () => command('eas', args, 10 * 60 * 1000))
      : command('eas', args, 10 * 60 * 1000),
  };
  try {
    const receipt = await runPackage(input, deps, execute);
    console.log(`Package ${receipt.phase}; ${input.platform}; receipt: ${receiptPath}`);
  } catch {
    // The durable receipt distinguishes preflight, known ID and uncertain creation.
    // It deliberately contains no raw CLI/GraphQL errors or provider-signed URL.
    throw new Error('Package operation did not verify. Inspect release-evidence/package.json and EAS by its exact ID; never automatically repeat creation. Raw provider output withheld.');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
