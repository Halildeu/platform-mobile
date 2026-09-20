import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { command, EAS_VERSION, requireValue } from './release-common.mjs';
import { validateResolvedSubmit } from './package-execute.mjs';
import { validatePackageInput } from './package-plan.mjs';

// Offline integration with the actually installed fixed CLI schema/resolver.
// Only synthetic app ID metadata is used; no EAS login or credential read.
try {
  const packagePath = process.env.EAS_CLI_PACKAGE_PATH || resolve(command('npm', ['root', '--global']), 'eas-cli/package.json');
  const cliRequire = createRequire(resolve(packagePath));
  requireValue(cliRequire('./package.json').version === EAS_VERSION, 'CLI resolver version differs');
  const api = cliRequire('@expo/eas-json');
  const eas = JSON.parse(readFileSync('eas.json', 'utf8'));
  const accessor = api.EasJsonAccessor.fromRawString(JSON.stringify(eas));
  for (const platform of ['android', 'ios']) {
    for (const channel of ['development', 'preview', 'production']) for (const ota of [false, true]) {
      const input = { operation: 'build', platform, channel, ota, sha: 'a'.repeat(40) };
      const expected = validatePackageInput(input);
      const profile = await api.EasJsonUtils.getBuildProfileAsync(accessor, platform, expected.profile);
      requireValue(profile.environment === channel && profile.channel === channel && profile.env.MOBILE_OTA_ENABLED === (ota ? '1' : '0') && profile.distribution.toUpperCase() === expected.distribution && profile.credentialsSource === 'remote', 'Resolved build profile differs');
      if (platform === 'ios') requireValue((profile.simulator === true) === expected.simulator, 'Resolved iOS simulator profile differs');
    }
    await validateResolvedSubmit({ operation: 'submit', platform, channel: 'production', ota: false, sha: 'a'.repeat(40),
      buildId: '10000000-0000-4000-8000-000000000001', digest: 'b'.repeat(64), ascAppId: '123456789' }, eas, api);
  }
  console.log('Pinned EAS resolver: 12 build targets and 2 materialized submit profiles passed; no credentials/API accessed.');
} catch {
  console.error('Pinned EAS profile integration failed; no provider operation attempted.'); process.exitCode = 1;
}
