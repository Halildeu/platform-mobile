import Constants from 'expo-constants';

/** This identifies bundled JS source, not a package digest or a server deployment. */
export function sourceIdentity(): { appVersion?: string; sourceRevision?: string } {
  const version = Constants.expoConfig?.version;
  const revision: unknown = Constants.expoConfig?.extra?.sourceRevision;
  return {
    ...(typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version) ? { appVersion: version } : {}),
    ...(typeof revision === 'string' && /^[0-9a-f]{40}$/.test(revision) ? { sourceRevision: revision } : {}),
  };
}
export function currentSourceLabel(): string {
  const identity = sourceIdentity();
  return `Şu anki uygulama: ${identity.appVersion ?? 'bilinmiyor'} · Kaynak sürümü: ${identity.sourceRevision ?? 'bu pakette belirtilmemiş'}`;
}
