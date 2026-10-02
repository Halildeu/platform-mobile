/** Metadata only. PCM and credentials never enter this bounded, encrypted index. */
export type BufferRecord = {
  id: string; ownerHash: string; sessionId: string; retentionMs: number;
  state: 'creating' | 'ready' | 'drained' | 'lost' | 'deleting';
  outcome?: 'drained' | 'lost';
};
type Storage = { read: () => Promise<string | null>; write: (value: string) => Promise<void> };
type Digest = (value: string) => Promise<string>;
const hashPattern = /^[a-f0-9]{64}$/;
const sessionPattern = /^[A-Za-z0-9._:-]{1,128}$/;
const invalid = () => new Error('Ses tamponu dizini doğrulanamadı; otomatik kapanış yapılmadı.');

export class AudioBufferJournal {
  private serial: Promise<unknown> = Promise.resolve();
  private leases = new Map<string, symbol>();
  constructor(private storage: Storage, private digest: Digest) {}

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
  /** The synchronous edit may seal its buffer; no await separates its checks and transition. */
  edit(id: string, lease: symbol, edit: (record: BufferRecord | undefined) => BufferRecord | undefined): Promise<void> {
    return this.ordered(async () => {
      this.assertLease(id, lease);
      const rows = await this.read();
      this.assertLease(id, lease);
      const next = edit(rows.find(row => row.id === id));
      if (next && next.id !== id) throw invalid();
      const updated = rows.filter(row => row.id !== id);
      if (next) updated.push(next);
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
    const row = (await this.list()).find(item => item.id === id);
    if (row && row.state !== 'drained' && !(row.state === 'deleting' && row.outcome === 'drained')) {
      throw new Error('Bekleyen veya eksik ses kaydı var; kurtarma tamamlanmadan toplantı kapatılamaz.');
    }
  }
}
