import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { printToFileAsync } from 'expo-print';
import { ResultExportManager, type ExportFile, type ExportIO } from './resultExportManager';

type ExportModules = {
  clipboard(): Promise<Pick<typeof import('expo-clipboard'), 'setStringAsync'>>;
  sharing(): Promise<Pick<typeof import('expo-sharing'), 'isAvailableAsync' | 'shareAsync'>>;
};

const PDF_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i;
function roots() {
  if (!FileSystem.cacheDirectory?.startsWith('file://')) throw new Error('Geçici dosya alanı kullanılamıyor.');
  return [FileSystem.cacheDirectory + 'meeting-exports/', FileSystem.cacheDirectory + 'Print/'];
}
export function isOwnedPdf(uri: string, directories = roots()): boolean {
  return directories.some(root => uri.startsWith(root) && PDF_NAME.test(uri.slice(root.length)));
}
function check(uri: string) { if (!isOwnedPdf(uri)) throw new Error('PDF dosya yolu doğrulanamadı.'); }
async function inspect(uri: string): Promise<ExportFile> {
  check(uri);
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || info.isDirectory) throw new Error('PDF dosyası bulunamadı.');
  return { uri, size: info.size, modified: info.modificationTime * 1000 };
}
export function createNativeResultExportIO(modules: ExportModules = {
  clipboard: () => import('expo-clipboard'), sharing: () => import('expo-sharing'),
}): ExportIO { return {
  available: async () => {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') return false;
    try { return await (await modules.sharing()).isAvailableAsync(); } catch { return false; }
  },
  files: async () => {
    const files: ExportFile[] = [];
    for (const root of roots()) {
      if (!(await FileSystem.getInfoAsync(root)).exists) continue;
      for (const name of await FileSystem.readDirectoryAsync(root)) {
        if (PDF_NAME.test(name)) files.push(await inspect(root + name));
      }
    }
    return files;
  },
  remove: async uri => { check(uri); await FileSystem.deleteAsync(uri, { idempotent: true }); },
  inspect,
  generate: async html => {
    const { uri } = await printToFileAsync({ html, base64: false });
    check(uri);
    return uri;
  },
  retain: async uri => {
    check(uri);
    const root = roots()[0];
    await FileSystem.makeDirectoryAsync(root, { intermediates: true });
    const to = root + Crypto.randomUUID() + '.pdf';
    await FileSystem.moveAsync({ from: uri, to });
    return to;
  },
  share: async (uri, beforeNative) => {
    check(uri);
    const sharing = await modules.sharing();
    beforeNative();
    await sharing.shareAsync(uri, {
      mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Toplantı PDF dosyasını paylaş',
    });
  },
  copy: async (text, beforeNative) => {
    const clipboard = await modules.clipboard();
    beforeNative();
    return clipboard.setStringAsync(text);
  },
}; }
export const resultExporter = new ResultExportManager(createNativeResultExportIO());
