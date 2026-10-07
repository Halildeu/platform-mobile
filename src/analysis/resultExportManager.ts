export type ExportFile = { uri: string; size: number; modified: number };
export type ExportIO = {
  available(): Promise<boolean>;
  files(): Promise<ExportFile[]>;
  remove(uri: string): Promise<void>;
  generate(html: string): Promise<string>;
  inspect(uri: string): Promise<ExportFile>;
  retain(uri: string): Promise<string>;
  share(uri: string, beforeNative: () => void): Promise<void>;
  copy(text: string, beforeNative: () => void): Promise<boolean>;
};
export const PDF_CACHE_MS = 10 * 60 * 1000;
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export class ExportCancelled extends Error {}

/** A share chooser finishing does not mean that its recipient has read the PDF. */
export class ResultExportManager {
  private working = false;
  private revision = 0;
  private resetPending = false;
  constructor(private readonly io: ExportIO, private readonly now = Date.now) {}

  private async sweep(all: boolean): Promise<ExportFile[]> {
    const remaining: ExportFile[] = [];
    for (const file of await this.io.files()) {
      if (all || !Number.isFinite(file.modified) || file.modified > this.now() ||
          file.modified + PDF_CACHE_MS <= this.now() || file.size > MAX_PDF_BYTES)
        await this.io.remove(file.uri);
      else remaining.push(file);
    }
    return remaining;
  }
  async cleanup(reset = false): Promise<void> {
    if (reset) { this.revision++; this.resetPending = true; }
    if (this.working) return;
    this.working = true;
    try {
      do { await this.sweepPending(); } while (this.resetPending);
    }
    finally { this.working = false; }
  }
  private async sweepPending(): Promise<ExportFile[]> {
    const revision = this.revision;
    const files = await this.sweep(this.resetPending);
    if (revision === this.revision) this.resetPending = false;
    return files;
  }
  private async exclusive(action: (current: () => void) => Promise<void>, isCurrent: () => boolean) {
    if (this.working) throw new Error('Başka bir dışa aktarma işlemi sürüyor.');
    this.working = true;
    const revision = this.revision;
    const current = () => { if (revision !== this.revision || !isCurrent()) throw new ExportCancelled(); };
    try { current(); await action(current); }
    finally {
      this.working = false;
      if (this.resetPending) await this.cleanup();
    }
  }
  async copy(text: string, isCurrent: () => boolean): Promise<void> {
    return this.exclusive(async current => {
      if (!text || text.length > 5_000_000) throw new Error('Metin kopyalama sınırını aşıyor veya boş.');
      current();
      if (!await this.io.copy(text, current)) throw new Error('Kopyalama tamamlanmadı.');
    }, isCurrent);
  }
  async pdf(html: string, isCurrent: () => boolean): Promise<void> {
    return this.exclusive(async current => {
      if (!html || html.length > 8_000_000) throw new Error('PDF içeriği boyut sınırını aşıyor veya boş.');
      if (!await this.io.available()) throw new Error('Bu uygulama sürümünde PDF paylaşımı kullanılamıyor.');
      const files = await this.sweepPending();
      if (files.length >= 3) throw new Error('Önceki PDF paylaşımları için bekleyip yeniden deneyin.');
      current();
      let file: string | undefined;
      let handedOff = false;
      try {
        file = await this.io.generate(html);
        current();
        const info = await this.io.inspect(file);
        if (!Number.isFinite(info.size) || info.size <= 0 || info.size > MAX_PDF_BYTES)
          throw new Error('PDF dosyası boyut sınırını aşıyor veya oluşturulamadı.');
        file = await this.io.retain(file);
        current();
        await this.io.share(file, () => {
          // Lazy native loading may cross an account or meeting change.
          current();
          // Only the actual native invocation makes delivery uncertain.
          handedOff = true;
        });
      } finally { if (file && !handedOff) await this.io.remove(file); }
    }, isCurrent);
  }
}
