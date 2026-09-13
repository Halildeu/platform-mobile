import { mobileSession } from '../mobileSession';
import { SessionExpired } from '../sessionManager';
import * as SecureStore from 'expo-secure-store';
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null), setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined), WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
}));
beforeEach(async () => { await mobileSession.clear(); jest.clearAllMocks(); });
afterEach(() => jest.restoreAllMocks());

it('uses encrypted device-only storage and rotates refresh tokens with a body-only request', async () => {
  await mobileSession.save({ jwt: 'old', refreshToken: 'refresh-old', expiresAt: 0, idToken: 'id-old' });
  const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200,
    json: async () => ({ access_token: 'access-new', refresh_token: 'refresh-new', expires_in: 300, id_token: 'id-new' }) } as Response);
  expect((await mobileSession.valid())?.jwt).toBe('access-new');
  expect(fetcher.mock.calls[0][0]).toBe('https://testai.acik.com/realms/platform-test/protocol/openid-connect/token');
  expect(fetcher.mock.calls[0][1]?.body).toContain('grant_type=refresh_token');
  expect(fetcher.mock.calls[0][1]?.body).not.toContain('client_secret');
  expect(SecureStore.setItemAsync).toHaveBeenLastCalledWith(expect.any(String), expect.stringContaining('refresh-new'), { keychainAccessible: 7 });
});
it('invalid_grant discards credentials without exposing provider response text', async () => {
  await mobileSession.save({ jwt: 'old', refreshToken: 'old', expiresAt: 0 });
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 400,
    json: async () => ({ error: 'invalid_grant', error_description: 'secret-data' }) } as Response);
  await expect(mobileSession.valid()).rejects.toEqual(new SessionExpired());
  expect(await mobileSession.valid()).toBeNull();
});
it('logout sends the ID token in POST body and deletes local storage first', async () => {
  await mobileSession.save({ jwt: 'access', refreshToken: 'refresh', idToken: 'id-hint', expiresAt: Date.now() + 300000 });
  const fetcher = jest.spyOn(global, 'fetch').mockImplementation(async () => {
    expect(SecureStore.deleteItemAsync).toHaveBeenCalled();
    return { ok: true, status: 200 } as Response;
  });
  expect(await mobileSession.logout()).toBe(true);
  expect(fetcher.mock.calls[0][0]).toBe('https://testai.acik.com/realms/platform-test/protocol/openid-connect/logout');
  expect(fetcher.mock.calls[0][1]?.body).toBe('client_id=platform-mobile&id_token_hint=id-hint');
});
