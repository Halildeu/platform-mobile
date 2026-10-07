export type PushScope = { applicationId: string; provider: 'FCM' | 'APNS'; environment: 'TEST' | 'PRODUCTION' };
export type PushIdentity = { owner: string; jwt: string; org: string; subscriber: string };
export type PushReceipt = PushScope & { installationId: string; owner: string; enabled: boolean };

/** Orders rotation, enable and logout. No bearer or device token is persisted here. */
export class NativePushManager {
  private work: Promise<unknown> = Promise.resolve();
  constructor(private readonly io: {
    read(): Promise<PushReceipt | null>;
    write(receipt: PushReceipt): Promise<void>;
    remove(): Promise<void>;
    uuid(): string;
    register(identity: PushIdentity, receipt: PushReceipt, token: string): Promise<void>;
    unregister(identity: PushIdentity, receipt: PushReceipt): Promise<void>;
  }) {}

  private ordered<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.work.then(operation, operation);
    this.work = next.catch(() => {});
    return next;
  }

  enable(identity: PushIdentity, scope: PushScope, token: string): Promise<void> {
    return this.ordered(async () => {
      const existing = await this.io.read();
      if (existing && existing.owner !== identity.owner)
        throw new Error('Önceki hesabın bildirim kaydı temizlenemedi. Önce o hesapla giriş yapıp bildirimleri kapatın.');
      if (existing && (existing.applicationId !== scope.applicationId || existing.provider !== scope.provider || existing.environment !== scope.environment))
        throw new Error('Önce önceki bildirim kaydını kapatın.');
      const receipt = { ...scope, installationId: existing?.installationId ?? this.io.uuid(), owner: identity.owner, enabled: false };
      // Persist BEFORE requesting enrollment: even a lost response remains cancellable.
      await this.io.write(receipt);
      await this.io.register(identity, receipt, token);
      await this.io.write({ ...receipt, enabled: true });
    });
  }

  rotate(identity: PushIdentity, token: string, isCurrent: (receipt: PushReceipt) => boolean = () => true): Promise<void> {
    return this.ordered(async () => {
      const receipt = await this.io.read();
      if (!receipt?.enabled || receipt.owner !== identity.owner || !isCurrent(receipt)) return;
      await this.io.register(identity, receipt, token);
    });
  }

  disable(identity: PushIdentity | null, isCurrent: (receipt: PushReceipt) => boolean = () => true): Promise<boolean> {
    return this.ordered(async () => {
      const receipt = await this.io.read();
      if (!receipt || !isCurrent(receipt)) return true;
      // Stop automatic rotations before the network operation, including offline logout.
      await this.io.write({ ...receipt, enabled: false });
      if (!identity || receipt.owner !== identity.owner) return false;
      try {
        await this.io.unregister(identity, receipt);
        await this.io.remove();
        return true;
      } catch { return false; }
    });
  }
}
