import { analysisHtml } from '../exportHtml';

it('keeps untrusted markup inert and preserves Turkish text and partial status', () => {
  const html = analysisHtml({ version: 2, partial: true, summary: '<img src="https://x" onerror="bad()">',
    decisions: ['Ödeme görüşülecek'], actions: [{ text: '</td><script>bad()</script>', owner: null, dueDate: null }] });
  expect(html).not.toContain('<script>'); expect(html).not.toContain('<img');
  expect(html).toContain('&lt;img'); expect(html).toContain('Ödeme görüşülecek');
  expect(html).toContain('kaydedilmiş nihai sonuç değildir'); expect(html).toContain('Belirtilmedi');
  expect(html).toContain("default-src 'none'");
});

it('renders empty sections honestly without inventing content', () => {
  const html = analysisHtml({ version: 0, partial: false, summary: '', decisions: [], actions: [] });
  expect(html).toContain('Gösterilebilir özet henüz yok.');
  expect(html).toContain('Henüz karar yok.'); expect(html).toContain('Henüz aksiyon yok.');
});
