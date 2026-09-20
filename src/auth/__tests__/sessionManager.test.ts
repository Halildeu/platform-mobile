import { SessionManager, SessionExpired, SessionUnavailable, type Session } from '../sessionManager';

function setup() {
  let stored: string | null = null;
  const io = {
    read: jest.fn(async () => stored),
    write: jest.fn(async (value: string) => { stored = value; }),
    remove: jest.fn(async () => { stored = null; }),
    refresh: jest.fn<Promise<Session>, [string]>().mockResolvedValue({ jwt: 'new', expiresAt: 500000, refreshToken: 'rotated' }),
    revoke: jest.fn<Promise<void>, [Session]>().mockResolvedValue(undefined),
  };
  return { io, manager: new SessionManager(io, () => 1000), stored: () => stored };
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
