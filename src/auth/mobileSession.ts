import * as SecureStore from 'expo-secure-store';
import { SessionManager, SessionExpired, SessionUnavailable } from './sessionManager';

const ROOT = 'https://testai.acik.com/realms/platform-test/protocol/openid-connect';
const KEY = 'platform-mobile.platform-test.session.v1';
async function post(endpoint: 'token' | 'logout', form: Record<string, string>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${ROOT}/${endpoint}`, { method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: 'platform-mobile', ...form }).toString() });
    const payload = endpoint === 'token' ? await response.json().catch(() => null) : null;
    return { ok: response.ok, status: response.status, payload };
  } finally { clearTimeout(timer); }
}
export const mobileSession = new SessionManager({
  read: () => SecureStore.getItemAsync(KEY),
  write: (value) => SecureStore.setItemAsync(KEY, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  remove: () => SecureStore.deleteItemAsync(KEY),
  refresh: async (refreshToken) => {
    const response = await post('token', { grant_type: 'refresh_token', refresh_token: refreshToken });
    const payload = response.payload;
    if (!response.ok) {
      if (response.status === 401 || (response.status === 400 && payload?.error === 'invalid_grant')) throw new SessionExpired();
      throw new SessionUnavailable();
    }
    if (typeof payload?.access_token !== 'string' || !Number.isFinite(payload?.expires_in) || payload.expires_in <= 0) throw new SessionUnavailable();
    return { jwt: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000,
      ...(typeof payload.id_token === 'string' && payload.id_token ? { idToken: payload.id_token } : {}),
      ...(typeof payload.refresh_token === 'string' && payload.refresh_token ? { refreshToken: payload.refresh_token } : {}) };
  },
  revoke: async (session) => {
    if (!session.idToken) throw new SessionUnavailable();
    // RP-Initiated Logout POST: ID token in body, never in a logged URL.
    const response = await post('logout', { id_token_hint: session.idToken });
    if (!response.ok) throw new SessionUnavailable();
  },
});
