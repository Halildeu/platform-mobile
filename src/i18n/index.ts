/**
 * i18next kurulumu (PR-mobile-03, #5 — "Türkçe i18next").
 *
 * Varsayılan dil Türkçe; İngilizce yedek. Cihaz dili `expo-localization`'dan
 * okunur ama çözümleme saf fonksiyon (`resolveInitialLanguage`) olarak ayrıldı,
 * böylece cihazsız birim test edilebilir. Modül bir kez import edildiğinde
 * (app/_layout.tsx) i18next global örneği hazır olur; `useTranslation()` her
 * yerde çalışır.
 */
import { getLocales } from 'expo-localization';
import i18n, { use as registerI18nPlugin } from 'i18next';
import { initReactI18next } from 'react-i18next';

export const SUPPORTED_LANGUAGES = ['tr', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = 'tr';

export const resources = {
  tr: {
    translation: {
      transcript: {
        waiting: 'Konuşma bekleniyor…',
        revisedTag: 'düzeltildi',
        stabilizingTag: 'kesinleşiyor',
        interruptedTag: 'bağlantı kesildi; bu metin kesinleşmedi',
        followLatest: 'Canlı metne dön',
        speaker: 'Konuşmacı {{number}}',
        unknownSpeaker: 'Konuşmacı bilinmiyor',
        speakerNotice: 'Konuşmacı etiketleri kişi adı veya kimlik doğrulaması değildir.',
      },
    },
  },
  en: {
    translation: {
      transcript: {
        waiting: 'Waiting for speech…',
        revisedTag: 'revised',
        stabilizingTag: 'stabilizing',
        interruptedTag: 'connection interrupted; this text was not finalized',
        followLatest: 'Follow live text',
        speaker: 'Speaker {{number}}',
        unknownSpeaker: 'Unknown speaker',
        speakerNotice: 'Speaker labels are not names or verified identities.',
      },
    },
  },
} as const;

/** Cihaz dil kodları arasından ilk desteklenen dili seç; yoksa Türkçe. Saf/test edilebilir. */
export function resolveInitialLanguage(
  deviceLanguageCodes: readonly (string | null | undefined)[],
): SupportedLanguage {
  for (const code of deviceLanguageCodes) {
    const lang = code?.toLowerCase().split('-')[0];
    if (lang && (SUPPORTED_LANGUAGES as readonly string[]).includes(lang)) {
      return lang as SupportedLanguage;
    }
  }
  return DEFAULT_LANGUAGE;
}

function deviceLanguageCodes(): string[] {
  try {
    return getLocales().map((l) => l.languageCode ?? '');
  } catch {
    return [];
  }
}

if (!i18n.isInitialized) {
  void registerI18nPlugin(initReactI18next).init({
    resources,
    lng: resolveInitialLanguage(deviceLanguageCodes()),
    fallbackLng: DEFAULT_LANGUAGE,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export default i18n;
