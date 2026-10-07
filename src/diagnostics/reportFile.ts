import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

const NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.txt$/i;
const TTL = 10 * 60 * 1000;
export class ReportCancelled extends Error {}
export class ReportFileExporter {
  private busy = false;
  private generation = 0;
  private reset = false;
  constructor(private readonly loadSharing: () => Promise<Pick<typeof import('expo-sharing'), 'isAvailableAsync' | 'shareAsync'>> = () => import('expo-sharing'), private readonly now = Date.now) {}
  private root() {
    if (!FileSystem.cacheDirectory?.startsWith('file://')) throw new Error('Geçici dosya alanı kullanılamıyor.');
    return FileSystem.cacheDirectory + 'technical-reports/';
  }
  private async sweep(all: boolean) {
    const root = this.root();
    if (!(await FileSystem.getInfoAsync(root)).exists) return 0;
    let retained = 0;
    for (const name of await FileSystem.readDirectoryAsync(root)) {
      if (!NAME.test(name)) continue;
      const uri = root + name;
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists || info.isDirectory) continue;
      if (all || !Number.isFinite(info.modificationTime) || info.modificationTime * 1000 > this.now() ||
          info.modificationTime * 1000 + TTL <= this.now() || info.size > 32 * 1024 * 1024)
        await FileSystem.deleteAsync(uri, { idempotent: true });
      else retained++;
    }
    return retained;
  }
  async cleanup(reset = false) {
    if (reset) { this.generation++; this.reset = true; }
    if (this.busy || Platform.OS === 'web') return;
    this.busy = true;
    try {
      do {
        const generation = this.generation;
        await this.sweep(this.reset);
        if (generation === this.generation) this.reset = false;
      } while (this.reset);
    } finally { this.busy = false; }
  }
  async share(text: string, isCurrent: () => boolean) {
    if (this.busy) throw new Error('Başka bir rapor işlemi sürüyor.');
    this.busy = true;
    const generation = this.generation;
    const current = () => { if (!isCurrent() || generation !== this.generation) throw new ReportCancelled(); };
    let uri: string | undefined;
    let handedOff = false;
    try {
      current();
      if (!['android', 'ios'].includes(Platform.OS) || !text || text.length > 16 * 1024 * 1024)
        throw new Error('Rapor bu cihazda paylaşılamıyor veya dosya sınırını aşıyor.');
      const sharing = await this.loadSharing();
      if (!await sharing.isAvailableAsync()) throw new Error('Dosya paylaşımı kullanılamıyor.');
      const count = await this.sweep(this.reset);
      current(); this.reset = false;
      if (count >= 3) throw new Error('Önceki dosya paylaşımlarından sonra 10 dakika bekleyin.');
      const root = this.root();
      await FileSystem.makeDirectoryAsync(root, { intermediates: true });
      current();
      const name = Crypto.randomUUID() + '.txt';
      if (!NAME.test(name)) throw new Error('Dosya adı doğrulanamadı.');
      uri = root + name;
      await FileSystem.writeAsStringAsync(uri, text, { encoding: FileSystem.EncodingType.UTF8 });
      current();
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists || info.isDirectory || info.size <= 0 || info.size > 32 * 1024 * 1024)
        throw new Error('Rapor dosyası oluşturulamadı.');
      current(); handedOff = true;
      await sharing.shareAsync(uri, { mimeType: 'text/plain', UTI: 'public.plain-text', dialogTitle: 'Teknik tanılama dosyasını paylaş' });
    } finally {
      try { if (uri && !handedOff) await FileSystem.deleteAsync(uri, { idempotent: true }); }
      finally { this.busy = false; if (this.reset) await this.cleanup(); }
    }
  }
}
export const reportFileExporter = new ReportFileExporter();
