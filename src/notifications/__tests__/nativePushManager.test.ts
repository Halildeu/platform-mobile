import { NativePushManager, type PushIdentity, type PushReceipt } from '../nativePushManager';

const identity: PushIdentity = { owner: 'alice', jwt: 'synthetic-bearer', org: 'org', subscriber: 'alice' };
const scope = { applicationId: 'com.workcube.meeting', provider: 'FCM', environment: 'TEST' } as const;
let stored: PushReceipt | null;
let register: jest.Mock;
let unregister: jest.Mock;
let manager: NativePushManager;
beforeEach(() => {
  stored = null; register = jest.fn().mockResolvedValue(undefined); unregister = jest.fn().mockResolvedValue(undefined);
  manager = new NativePushManager({ read: async () => stored, write: async value => { stored = value; },
    remove: async () => { stored = null; }, uuid: () => 'installation', register, unregister });
});
it('persists a token-free cancellation receipt before registration', async () => {
  register.mockImplementation(async () => {
    expect(stored).toMatchObject({ enabled: false, owner: 'alice' });
    expect(JSON.stringify(stored)).not.toContain('synthetic');
  });
  await manager.enable(identity, scope, 'synthetic-device-token');
  expect(stored?.enabled).toBe(true);
});
it('keeps an ambiguous enrollment cancellable after a lost response', async () => {
  register.mockRejectedValue(new Error('offline'));
  await expect(manager.enable(identity, scope, 'token')).rejects.toThrow();
  expect(stored?.enabled).toBe(false);
  expect(await manager.disable(identity)).toBe(true);
  expect(unregister).toHaveBeenCalledTimes(1);
  expect(stored).toBeNull();
});
it('blocks takeover when offline logout cannot remove the old registration', async () => {
  await manager.enable(identity, scope, 'token');
  unregister.mockRejectedValue(new Error('offline'));
  expect(await manager.disable(identity)).toBe(false);
  expect(stored?.enabled).toBe(false);
  await expect(manager.enable({ ...identity, owner: 'bob' }, scope, 'token')).rejects.toThrow('Önceki hesabın');
  expect(register).toHaveBeenCalledTimes(1);
});
it('orders logout after an in-flight registration and ignores late rotation', async () => {
  let complete!: () => void;
  register.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
  const enabling = manager.enable(identity, scope, 'token');
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  const disabling = manager.disable(identity);
  const rotating = manager.rotate(identity, 'new-token');
  complete();
  await enabling; expect(await disabling).toBe(true); await rotating;
  expect(register).toHaveBeenCalledTimes(1);
  expect(stored).toBeNull();
});
it('retries cleanup with the old account and permits a new account only afterwards', async () => {
  await manager.enable(identity, scope, 'token');
  expect(await manager.disable({ ...identity, owner: 'bob' })).toBe(false);
  expect(unregister).not.toHaveBeenCalled();
  expect(await manager.disable(identity)).toBe(true);
  await manager.enable({ ...identity, owner: 'bob' }, scope, 'new-token');
  expect(stored?.owner).toBe('bob');
});
it('renews the same installation and ignores another account token updates', async () => {
  await manager.enable(identity, scope, 'token');
  await manager.rotate({ ...identity, owner: 'bob' }, 'other');
  await manager.rotate(identity, 'new');
  expect(register).toHaveBeenCalledTimes(2);
  expect(register.mock.calls[1][1].installationId).toBe('installation');
  expect(register.mock.calls[1][2]).toBe('new');
});
