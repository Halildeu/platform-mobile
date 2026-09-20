// Native Detox handshake + real unauthenticated home; no physical device claim.

import { by, device, element, expect as detoxExpect } from 'detox';

describe('app-launch', () => {
  beforeAll(async () => {
    await device.launchApp({
      newInstance: true,
      permissions: { notifications: 'YES' },
    });
  });

  it('renders the actual home screen', async () => {
    await detoxExpect(element(by.id('app-root'))).toBeVisible();
    await detoxExpect(element(by.id('app-home-title'))).toBeVisible();
    await device.takeScreenshot('detox-home-visible');
  });
});
