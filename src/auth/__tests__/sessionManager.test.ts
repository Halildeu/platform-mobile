import { SessionManager, SessionExpired, SessionUnavailable, type Session } from '../sessionManager';

function setup(now = () => 1000) {
  let stored: string | null = null;
  const io = {
    read: jest.fn(async () => stored),
    write: jest.fn(async (value: string) => { stored = value; }),
    remove: jest.fn(async () => { stored = null; }),
    refresh: jest.fn<Promise<Session>, [string]>().mockResolvedValue({ jwt: 'new', expiresAt: 500000, refreshToken: 'rotated' }),
    revoke: jest.fn<Promise<void>, [Session]>().mockResolvedValue(undefined),
  };
  return { io, manager: new SessionManager(io, now), stored: () => stored };
}
const expired = { jwt: 'old', expiresAt: 900, refreshToken: 'refresh' };

it('content ownership survives refresh but not logout and login to the same account', async () => {
  const { manager } = setup();
  expect(manager.contentScope()).toBeNull();
  await manager.save({ ...expired, expiresAt: 2000 });
  const first = manager.contentScope();
  await manager.valid(10000);
  expect(manager.contentScope()).toBe(first);
  await manager.clear();
  expect(manager.contentScope()).toBeNull();
  await manager.save({ ...expired, expiresAt: 500000 });
  expect(manager.contentScope()).not.toBe(first);
});

it('snapshot never loads or renews credentials and disappears during account changes', async () => {
  const { manager, io } = setup();
  expect(manager.snapshot()).toBeNull();
  expect(io.read).not.toHaveBeenCalled();
  await manager.save({ ...expired, expiresAt: 500000 });
  expect(manager.snapshot()).toEqual({ jwt: 'old', expiresAt: 500000 });
  const clearing = manager.clear();
  expect(manager.snapshot()).toBeNull();
  await clearing;
  await manager.save(expired);
  expect(manager.snapshot()).toBeNull();
  expect(io.refresh).not.toHaveBeenCalled();
  let finish!: () => void;
  io.write.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const saving = manager.save({ ...expired, jwt: 'new-account', expiresAt: 500000 });
  expect(manager.snapshot()).toBeNull();
  while (!finish) await Promise.resolve();
  finish(); await saving;
  expect(manager.snapshot()?.jwt).toBe('new-account');
});

it('restores a persisted session without unnecessary refresh', async () => {
  const { io, manager } = setup();
  await manager.save({ ...expired, expiresAt: 500000 });
  const restarted = new SessionManager(io, () => 1000);
  expect((await restarted.valid())?.jwt).toBe('old');
  expect(io.refresh).not.toHaveBeenCalled();
});
it('coalesces concurrent refresh and persists the rotated credential', async () => {
  const { io, manager, stored } = setup();
  await manager.save(expired);
  const results = await Promise.all([manager.valid(), manager.valid(), manager.valid()]);
  expect(io.refresh).toHaveBeenCalledTimes(1);
  expect(results.every((item) => item?.jwt === 'new')).toBe(true);
  expect(JSON.parse(stored()!).refreshToken).toBe('rotated');
});
it('cannot resurrect an account when refresh returns after logout', async () => {
  const { io, manager, stored } = setup();
  await manager.save(expired);
  let resolve!: (value: Session) => void;
  io.refresh.mockReturnValue(new Promise((done) => { resolve = done; }));
  const pending = manager.valid();
  const rejected = expect(pending).rejects.toBeInstanceOf(SessionExpired);
  await Promise.resolve(); await Promise.resolve();
  await manager.logout();
  resolve({ jwt: 'late', expiresAt: 500000 });
  await rejected;
  expect(await manager.valid()).toBeNull();
  expect(stored()).toBeNull();
});
it('clears rejected refresh tokens but retains session on a temporary network error', async () => {
  const { io, manager } = setup();
  await manager.save(expired);
  io.refresh.mockRejectedValueOnce(new Error('Bearer secret should never be shown'));
  await expect(manager.valid()).rejects.toEqual(new SessionUnavailable());
  io.refresh.mockRejectedValueOnce(new SessionExpired());
  await expect(manager.valid()).rejects.toBeInstanceOf(SessionExpired);
  expect(await manager.valid()).toBeNull();
});
it('local logout succeeds even when server revocation is unavailable', async () => {
  const { io, manager, stored } = setup();
  await manager.save(expired); io.revoke.mockRejectedValue(new Error('offline'));
  expect(await manager.logout()).toBe(false);
  expect(stored()).toBeNull(); expect(await manager.valid()).toBeNull();
});
it('discards malformed storage and does not persist access-only sessions', async () => {
  const { io, manager, stored } = setup();
  io.read.mockResolvedValueOnce('{bad');
  expect(await manager.valid()).toBeNull();
  await manager.save({ jwt: 'memory-only', expiresAt: 500000 });
  expect(stored()).toBeNull();
  expect((await manager.valid())?.jwt).toBe('memory-only');
});
it('an old request rejection does not clear a newer account session', async () => {
  const { manager } = setup();
  await manager.save({ ...expired, jwt: 'new-account', expiresAt: 500000 });
  await manager.reject('old-account');
  expect((await manager.valid())?.jwt).toBe('new-account');
});

it.each([false, true])('checks each concurrent lifetime requirement and retains rotation (strict first=%s)', async strictFirst => {
  const { io, manager, stored } = setup(); await manager.save(expired);
  io.refresh.mockResolvedValueOnce({ jwt: 'short', expiresAt: 31000, refreshToken: 'rotated-short' });
  const thresholds = strictFirst ? [120000, 15000] : [15000, 120000];
  const results = await Promise.allSettled(thresholds.map(threshold => manager.valid(threshold)));
  const strict = results[thresholds.indexOf(120000)]; const shorter = results[thresholds.indexOf(15000)];
  expect(strict).toMatchObject({ status: 'rejected', reason: new SessionUnavailable() });
  expect(shorter).toMatchObject({ status: 'fulfilled', value: { jwt: 'short' } });
  expect(io.refresh).toHaveBeenCalledTimes(1);
  expect(JSON.parse(stored()!).refreshToken).toBe('rotated-short');
  await manager.valid(120000);
  expect(io.refresh).toHaveBeenLastCalledWith('rotated-short');
});

it('rechecks the clock after persistence while retaining the rotated refresh token', async () => {
  let now = 1000;
  const { io, manager, stored } = setup(() => now); await manager.save(expired);
  const write = io.write.getMockImplementation()!;
  io.write.mockImplementationOnce(async value => { await write(value); now = 500000; });
  await expect(manager.valid(15000)).rejects.toBeInstanceOf(SessionUnavailable);
  expect(JSON.parse(stored()!).refreshToken).toBe('rotated');
  expect(manager.snapshot()).toBeNull();
});

it('retains valid rotation even if the access token expires during the refresh response', async () => {
  const { manager, io, stored } = setup(); await manager.save(expired);
  io.refresh.mockResolvedValueOnce({ jwt: 'too-late', expiresAt: 999, refreshToken: 'fresh-rotation' });
  await expect(manager.valid(0)).rejects.toBeInstanceOf(SessionUnavailable);
  expect(JSON.parse(stored()!).refreshToken).toBe('fresh-rotation');
  await manager.valid(0);
  expect(io.refresh).toHaveBeenLastCalledWith('fresh-rotation');
});

it('copies save input before yielding so caller mutation cannot change the persisted identity', async () => {
  const { manager, stored } = setup(); const input = { ...expired, expiresAt: 500000 };
  const save = manager.save(input);
  input.jwt = 'unrelated-account'; input.refreshToken = 'unrelated-refresh';
  expect((await save).jwt).toBe('old');
  expect(manager.snapshot()?.jwt).toBe('old');
  expect(JSON.parse(stored()!).refreshToken).toBe('refresh');
});

it('each coalesced waiter receives a separate credential copy', async () => {
  const { manager } = setup(); await manager.save(expired);
  const [first, second] = await Promise.all([manager.valid(), manager.valid()]);
  first!.jwt = 'changed-by-caller';
  expect(second!.jwt).toBe('new'); expect(manager.snapshot()?.jwt).toBe('new');
});

it.each([-1, NaN, Infinity, 1.2, Number.MAX_SAFE_INTEGER + 1])('rejects invalid minimum %s before credential I/O', async threshold => {
  const { manager, io } = setup();
  await expect(manager.valid(threshold)).rejects.toThrow();
  expect(io.read).not.toHaveBeenCalled(); expect(io.refresh).not.toHaveBeenCalled();
});

it('all coalesced waiters reject a late refresh after account replacement', async () => {
  const { io, manager, stored } = setup(); await manager.save(expired);
  let resolve!: (value: Session) => void;
  io.refresh.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const results = Promise.allSettled([manager.valid(15000), manager.valid(120000)]);
  while (!io.refresh.mock.calls.length) await Promise.resolve();
  await manager.save({ jwt: 'other-account', expiresAt: 500000, refreshToken: 'other-refresh' });
  resolve({ jwt: 'late-old-account', expiresAt: 500000, refreshToken: 'old-rotation' });
  for (const result of await results) expect(result).toMatchObject({ status: 'rejected', reason: new SessionExpired() });
  expect(manager.snapshot()?.jwt).toBe('other-account');
  expect(JSON.parse(stored()!).refreshToken).toBe('other-refresh');
});
