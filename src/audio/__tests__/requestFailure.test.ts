import { requestFailure } from '../requestFailure';

test('result 404 explains uncertainty without asserting processing or changing other 404s', () => {
  const result = requestFailure('Kalıcı toplantı sonucu', 404, { correlationId: '12345678-1234-1234-1234-123456789abc' });
  expect(result).toContain('işlemenin sürdüğünü doğrulamaz');
  expect(result).toContain('12345678-1234-1234-1234-123456789abc');
  expect(requestFailure('Toplantı listesi', 404, {})).not.toContain('hazırlanmamış');
});

test('403 identifies the operation without claiming a password failure', () => {
  expect(requestFailure('Toplantı listesi', 403, {})).toContain('Toplantı listesi (403)');
  expect(requestFailure('Toplantı listesi', 403, {})).toContain('şifre hatası değildir');
});
test('only safe structured diagnostics are displayed', () => {
  const message = requestFailure('Toplantı listesi', 403, {
    code: 'AUTHZ_DENIED', correlationId: '12345678-1234-1234-1234-123456789abc',
    message: 'secret-person@example.com', token: 'private-token',
  });
  expect(message).toContain('AUTHZ_DENIED');
  expect(message).toContain('12345678-1234-1234-1234-123456789abc');
  expect(message).not.toContain('secret-person');
  expect(message).not.toContain('private-token');
});
test('untrusted diagnostic values are not reflected', () => {
  const message = requestFailure('Toplantı listesi', 403, { code: 'Bearer private', correlationId: 'person@example.com' });
  expect(message).not.toContain('Bearer');
  expect(message).not.toContain('@');
});
