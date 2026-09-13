import { redirectAuthPath } from '../authRedirect';

test('warm callback stays with AuthSession and does not navigate to a missing page', () => {
  expect(redirectAuthPath('workcube://oauthredirect?code=test-code&state=test-state', false)).toBe('');
});
test('OAuth error callback also remains with AuthSession', () => {
  expect(redirectAuthPath('workcube://oauthredirect?error=access_denied', false)).toBe('');
});
test('cold callback restarts login without putting credentials in router state', () => {
  expect(redirectAuthPath('workcube://oauthredirect?code=test-code&state=test-state', true)).toBe('/live-test?authRestart=1');
});
test.each(['/transcript-demo', 'workcube://live-test', 'https://other.example/oauthredirect', 'workcube://oauthredirect/other'])('unrelated route is preserved: %s', (path) => {
  expect(redirectAuthPath(path, false)).toBe(path);
});
