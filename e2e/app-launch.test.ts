// Faz 24 M6 mobile E2E — Detox app-launch smoke (skeleton).
//
// Kept intentionally minimal: a launch + visibility check that mirrors
// the primary Maestro flow (.maestro/flows/01-app-launch.yaml). Wire
// this once the Expo prebuild is committed and `eas build --profile
// development` produces the .app / .apk that Detox consumes.
//
// A green run of BOTH this Detox spec and the Maestro flow provides
// two-track E2E coverage (see docs/e2e-strategy.md § two-track).

import { by, device, element, expect as detoxExpect } from 'detox';

describe('app-launch', () => {
  beforeAll(async () => {
    await device.launchApp({
      newInstance: true,
      permissions: { notifications: 'YES' },
    });
  });

  it('renders the app-root and lands on the meeting list header', async () => {
    await detoxExpect(element(by.id('app-root'))).toBeVisible();
    await detoxExpect(element(by.id('meeting-list-header'))).toBeVisible();
  });
});
