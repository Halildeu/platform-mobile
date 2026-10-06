import { BufferStorageError } from './bufferFailure';
/** Metadata only. PCM and credentials never enter this bounded, encrypted index. */
export type BufferRecord = {
  id: string; ownerHash: string; sessionId: string; retentionMs: number;
  state: 'creating' | 'ready' | 'drained' | 'lost' | 'deleting';
  outcome?: 'drained' | 'lost';
};
type Storage = { read: () => Promise<string | null>; write: (value: string) => Promise<void> };
type Digest = (value: string) => Promise<string>;
type LossHistory = Record<string, string[]>;
const hashPattern = /^[a-f0-9]{64}$/;
const sessionPattern = /^[A-Za-z0-9._:-]{1,128}$/;
const invalid = () => new Error('Ses tamponu dizini doğrulanamadı; otomatik kapanış yapılmadı.');

export class AudioBufferJournal {
  private serial: Promise<unknown> = Promise.resolve();
  private leases = new Map<string, symbol>();
  constructor(private storage: Storage, private digest: Digest, private lossStorage?: Storage) {}

  private async readLosses(): Promise<LossHistory> {
    if (!this.lossStorage) return {};
    try {
      const raw = await this.lossStorage.read();
      if (raw === null) return {};
      if (new TextEncoder().encode(raw).byteLength > 2048) throw invalid();
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || Object.keys(parsed).sort().join(',') !== 'owners,version' ||
          !parsed.owners || Array.isArray(parsed.owners) || typeof parsed.owners !== 'object') throw invalid();
      const ids = new Set<string>();
      for (const [owner, values] of Object.entries(parsed.owners)) {
        if (!hashPattern.test(owner) || !Array.isArray(values) || !values.length) throw invalid();
        for (const id of values) {
          if (typeof id !== 'string' || !hashPattern.test(id) || ids.has(id)) throw invalid();
          ids.add(id);
        }
      }
      if (ids.size > 20) throw invalid();
      return parsed.owners;
    } catch { throw invalid(); }
  }
  private async writeLosses(owners: LossHistory): Promise<void> {
    if (!this.lossStorage) throw invalid();
    const raw = JSON.stringify({ version: 1, owners });
    if (Object.values(owners).flat().length > 20 || new TextEncoder().encode(raw).byteLength > 2048) {
      throw new BufferStorageError('AUDIO_HISTORY_CAPACITY');
    }
    try {
      await this.lossStorage.write(raw);
      if (await this.lossStorage.read() !== raw) throw invalid();
    } catch { throw invalid(); }
  }
  lossHistory(): Promise<{ ownerHash: string; id: string }[]> {
    return this.ordered(async () => Object.entries(await this.readLosses()).flatMap(([ownerHash, ids]) => ids.map(id => ({ ownerHash, id }))));
  }
  async hasLoss(ownerHash: string, sessionId: string): Promise<boolean> {
    const id = await this.identity(ownerHash, sessionId);
    return this.ordered(async () => (await this.readLosses())[ownerHash]?.includes(id) ?? false);
  }
  /** Caller has closed and verified removal of the DB, sidecars and key. Copy proof BEFORE freeing the slot. */
  archiveLost(record: BufferRecord, lease: symbol): Promise<void> {
    return this.ordered(async () => {
      this.assertLease(record.id, lease);
      const rows = await this.read();
      const row = rows.find(item => item.id === record.id);
      const owners = await this.readLosses();
      this.assertLease(record.id, lease);
      if (!row) {
        if (owners[record.ownerHash]?.includes(record.id)) return; // prior removal committed, verification failed
        throw invalid();
      }
      if (row.ownerHash !== record.ownerHash || !(row.state === 'lost' || (row.state === 'deleting' && row.outcome === 'lost'))) throw invalid();
      if (Object.entries(owners).some(([owner, ids]) => owner !== record.ownerHash && ids.includes(record.id))) throw invalid();
      if (!owners[record.ownerHash]?.includes(record.id)) {
        owners[record.ownerHash] = [...(owners[record.ownerHash] ?? []), record.id];
        await this.writeLosses(owners);
      }
      this.assertLease(record.id, lease);
      const raw = JSON.stringify({ version: 1, records: rows.filter(item => item.id !== record.id) });
      try {
        await this.storage.write(raw);
        if (await this.storage.read() !== raw) throw invalid();
      } catch { throw invalid(); }
    });
  }
  /** Explicit abandonment acknowledged by servers, or approved owner logout cleanup only. */
  forgetLoss(id: string, lease: symbol): Promise<void> {
    return this.ordered(async () => {
      this.assertLease(id, lease);
      if ((await this.read()).some(row => row.id === id)) throw invalid();
      const owners = await this.readLosses();
      this.assertLease(id, lease);
      let changed = false;
      for (const owner of Object.keys(owners)) {
        if (!owners[owner].includes(id)) continue;
        changed = true;
        owners[owner] = owners[owner].filter(value => value !== id);
        if (!owners[owner].length) delete owners[owner];
      }
      if (changed) await this.writeLosses(owners);
    });
  }

  async identity(ownerHash: string, sessionId: string): Promise<string> {
    if (!hashPattern.test(ownerHash) || !sessionPattern.test(sessionId)) throw invalid();
    const id = await this.digest(JSON.stringify([ownerHash, sessionId]));
    if (!hashPattern.test(id)) throw invalid();
    return id;
  }

  /** Reserved synchronously, before any native open, and held until close succeeds. */
  acquire(id: string): symbol | null {
    if (!hashPattern.test(id)) throw invalid();
    if (this.leases.has(id)) return null;
    const lease = Symbol(id); this.leases.set(id, lease); return lease;
  }
  release(id: string, lease: symbol): void {
    this.assertLease(id, lease); this.leases.delete(id);
  }
  private assertLease(id: string, lease: symbol) {
    if (this.leases.get(id) !== lease) throw invalid();
  }
  private ordered<T>(work: () => Promise<T>): Promise<T> {
    const next = this.serial.then(work, work); this.serial = next.catch(() => {}); return next;
  }
  private async validate(records: unknown): Promise<BufferRecord[]> {
    if (!Array.isArray(records) || records.length > 4) throw invalid();
    const ids = new Set<string>();
    for (const row of records) {
      if (!row || typeof row !== 'object' || Object.keys(row).some(k => !['id', 'ownerHash', 'sessionId', 'retentionMs', 'state', 'outcome'].includes(k)) ||
          typeof row.ownerHash !== 'string' || typeof row.sessionId !== 'string' ||
          !Number.isSafeInteger(row.retentionMs) || row.retentionMs <= 0 ||
          !['creating', 'ready', 'drained', 'lost', 'deleting'].includes(row.state) ||
          (row.state === 'deleting' ? !['drained', 'lost'].includes(row.outcome) : row.outcome !== undefined) ||
          row.id !== await this.identity(row.ownerHash, row.sessionId) || ids.has(row.id)) throw invalid();
      ids.add(row.id);
    }
    return records;
  }
  private async read(): Promise<BufferRecord[]> {
    let value: string | null;
    try { value = await this.storage.read(); } catch { throw invalid(); }
    // Locked/unavailable is an error, never an empty journal.
    if (value === null) return [];
    if (new TextEncoder().encode(value).byteLength > 2048) throw invalid();
    let parsed;
    try { parsed = JSON.parse(value); } catch { throw invalid(); }
    if (!parsed || parsed.version !== 1 || Object.keys(parsed).sort().join(',') !== 'records,version') throw invalid();
    return this.validate(parsed.records);
  }
  list(): Promise<BufferRecord[]> { return this.ordered(() => this.read()); }
  /** Read-only preflight. The atomic edit still checks capacity against concurrent starts. */
  assertCapacity(): Promise<void> {
    return this.ordered(async () => {
      if (Object.values(await this.readLosses()).flat().length >= 20) throw new BufferStorageError('AUDIO_HISTORY_CAPACITY');
      if ((await this.read()).length >= 4) throw new BufferStorageError('AUDIO_CAPACITY');
    });
  }
  /** The synchronous edit may seal its buffer; no await separates its checks and transition. */
  edit(id: string, lease: symbol, edit: (record: BufferRecord | undefined) => BufferRecord | undefined): Promise<void> {
    return this.ordered(async () => {
      this.assertLease(id, lease);
      const rows = await this.read();
      this.assertLease(id, lease);
      const next = edit(rows.find(row => row.id === id));
      if (next && next.id !== id) throw invalid();
      if (next?.state === 'creating' && Object.values(await this.readLosses()).some(ids => ids.includes(id))) throw invalid();
      const updated = rows.filter(row => row.id !== id);
      if (next) updated.push(next);
      if (updated.length > 4) throw new BufferStorageError('AUDIO_CAPACITY');
      await this.validate(updated);
      const value = JSON.stringify({ version: 1, records: updated });
      if (new TextEncoder().encode(value).byteLength > 2048) throw invalid();
      try {
        await this.storage.write(value);
        if (await this.storage.read() !== value) throw invalid();
      } catch { throw invalid(); }
    });
  }
  async assertFinishAllowed(ownerHash: string, sessionId: string): Promise<void> {
    const id = await this.identity(ownerHash, sessionId);
    return this.ordered(async () => {
      const loss = (await this.readLosses())[ownerHash]?.includes(id);
      const row = (await this.read()).find(item => item.id === id);
      if (loss || (row && row.state !== 'drained' && !(row.state === 'deleting' && row.outcome === 'drained'))) {
        throw new Error('Bekleyen veya eksik ses kaydı var; kurtarma tamamlanmadan toplantı kapatılamaz.');
      }
    });
  }
}
