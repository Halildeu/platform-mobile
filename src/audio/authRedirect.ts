/** Router must not consume the OAuth callback owned by AuthSession. */
export function redirectAuthPath(path: string, initial: boolean): string {
  try {
    const url = new URL(path);
    if (url.protocol === 'workcube:' && url.hostname === 'oauthredirect' &&
        (url.pathname === '' || url.pathname === '/')) {
      // On a cold start the in-memory PKCE verifier no longer exists. Restart
      // login rather than attempting an exchange with unverified callback data.
      return initial ? '/live-test?authRestart=1' : '';
    }
  } catch {
    // Relative application routes are not OAuth responses.
  }
  return path;
}
