export interface Session { jwt: string; expiresAt: number; refreshToken?: string; idToken?: string }
export class SessionExpired extends Error {
  constructor() { super('Oturum sona erdi. Lütfen yeniden giriş yapın.'); }
}
export class SessionUnavailable extends Error {
  constructor() { super('Oturum yenilenemedi. Bağlantınızı kontrol edip tekrar deneyin.'); }
}

/** All credential writes are ordered. A late refresh cannot undo logout. */
export class SessionManager {
  private current: Session | null = null;
  private loaded = false;
  private epoch = 0;
  private writes: Promise<unknown> = Promise.resolve();
  private loading: Promise<void> | undefined;
  private refreshing: Promise<Session> | undefined;
  constructor(private readonly io: {
    read(): Promise<string | null>; write(value: string): Promise<void>; remove(): Promise<void>;
    refresh(token: string): Promise<Session>; revoke(session: Session): Promise<void>;
  }, private readonly now = Date.now) {}

  /** In-memory identity only: notification presentation must never restore or refresh. */
  snapshot(): Pick<Session, 'jwt' | 'expiresAt'> | null {
    const value = this.current;
    return this.loaded && value && value.expiresAt > this.now()
      ? { jwt: value.jwt, expiresAt: value.expiresAt } : null;
  }

  private ordered<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writes.then(operation, operation);
    this.writes = next.catch(() => {});
    return next;
  }
  private async restore(): Promise<void> {
    if (this.loaded) return;
    if (this.loading) return this.loading;
    const epoch = this.epoch;
    const task = (async () => {
      const raw = await this.io.read();
      if (epoch !== this.epoch) return;
      let value: Session | null = null;
      try {
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed.jwt === 'string' && parsed.jwt.length > 0 &&
          Number.isFinite(parsed.expiresAt) && typeof parsed.refreshToken === 'string' && parsed.refreshToken.length > 0) value = parsed;
      } catch { /* Invalid stored credentials are discarded, never logged. */ }
      if (raw && !value) await this.ordered(() => this.io.remove());
      if (epoch !== this.epoch) return;
      this.current = value; this.loaded = true;
    })();
    this.loading = task;
    try { await task; } finally { if (this.loading === task) this.loading = undefined; }
  }
  async save(value: Session): Promise<Session> {
    const epoch = ++this.epoch;
    this.loaded = true; this.current = null; this.refreshing = undefined;
    await this.ordered(() => value.refreshToken ? this.io.write(JSON.stringify(value)) : this.io.remove());
    if (epoch !== this.epoch) throw new SessionExpired();
    this.current = value;
    return { ...value };
  }
  async valid(minRemainingMs = 60000): Promise<Session | null> {
    await this.restore();
    const value = this.current;
    if (!value) return null;
    if (value.expiresAt - this.now() > minRemainingMs) return { ...value };
    if (!value.refreshToken) { await this.clear(); throw new SessionExpired(); }
    if (this.refreshing) return this.refreshing;
    const epoch = this.epoch;
    const task = (async () => {
      try {
        const result = await this.io.refresh(value.refreshToken!);
        if (epoch !== this.epoch) throw new SessionExpired();
        const next = { ...result, refreshToken: result.refreshToken ?? value.refreshToken, idToken: result.idToken ?? value.idToken };
        if (!next.jwt || !Number.isFinite(next.expiresAt) || next.expiresAt - this.now() <= minRemainingMs) throw new SessionUnavailable();
        await this.ordered(() => epoch === this.epoch ? this.io.write(JSON.stringify(next)) : Promise.resolve());
        if (epoch !== this.epoch) throw new SessionExpired();
        this.current = next;
        return { ...next };
      } catch (error) {
        if (error instanceof SessionExpired && epoch === this.epoch) await this.clear();
        throw error instanceof SessionExpired ? error : new SessionUnavailable();
      }
    })();
    this.refreshing = task;
    try { return await task; } finally { if (this.refreshing === task) this.refreshing = undefined; }
  }
  async clear(): Promise<void> {
    ++this.epoch; this.loaded = true; this.current = null; this.refreshing = undefined;
    // Tombstone first: if deletion fails after this write, restart cannot restore credentials.
    await this.ordered(async () => { await this.io.write('null'); await this.io.remove(); });
  }
  async reject(jwt: string): Promise<void> {
    if (this.current?.jwt === jwt) await this.clear();
  }
  async logout(): Promise<boolean> {
    await this.restore();
    const previous = this.current;
    await this.clear();
    if (!previous) return true;
    try { await this.io.revoke(previous); return true; } catch { return false; }
  }
}
