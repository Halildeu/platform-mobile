import {
  DEFAULT_LANGUAGE,
  resolveInitialLanguage,
  resources,
} from '../index';

describe('resolveInitialLanguage', () => {
  it('ilk desteklenen cihaz dilini seçer', () => {
    expect(resolveInitialLanguage(['en', 'tr'])).toBe('en');
    expect(resolveInitialLanguage(['tr'])).toBe('tr');
  });

  it('bölge ekli kodları taban dile indirger (en-US -> en)', () => {
    expect(resolveInitialLanguage(['en-US'])).toBe('en');
    expect(resolveInitialLanguage(['tr-TR'])).toBe('tr');
  });

  it('desteklenmeyen / boş dillerde Türkçe varsayılana düşer', () => {
    expect(resolveInitialLanguage(['de', 'fr'])).toBe('tr');
    expect(resolveInitialLanguage([null, undefined, ''])).toBe('tr');
    expect(resolveInitialLanguage([])).toBe(DEFAULT_LANGUAGE);
  });
});

describe('resources', () => {
  it('tr ve en transcript anahtarlarını içerir', () => {
    expect(resources.tr.translation.transcript.waiting).toBeTruthy();
    expect(resources.en.translation.transcript.waiting).toBeTruthy();
    expect(resources.tr.translation.transcript.revisedTag).toBe('düzeltildi');
  });
});
