import { analysisMarkdown } from '../exportMarkdown';
import { parseAnalysis } from '../liveAnalysis';

it('marks partial analysis and preserves Turkish fields without inventing assignees', () => {
  const result = analysisMarkdown({ version: 3, partial: true, summary: 'Görüşme sürüyor.',
    decisions: ['Ödeme yapılacak'], actions: [{ text: 'Teklifi gönder', owner: null, dueDate: null }] });
  expect(result).toContain('toplantı sürerken değişebilir');
  expect(result).toContain('Belirtilmedi'); expect(result).toContain('Teklifi gönder');
});
it('escapes markup and line breaks to keep action table structure', () => {
  const result = analysisMarkdown({ version: 0, partial: false, summary: '<script>bad</script>',
    decisions: [], actions: [{ text: 'A|B\n# başlık', owner: '[kişi](https://bad)', dueDate: null }] });
  expect(result).not.toContain('<script>'); expect(result).not.toContain('\n# başlık');
  expect(result).toContain('A\\|B'); expect(result).toContain('\\[kişi\\]');
});
it('does not export withheld summaries or rejected server claims', () => {
  const snapshot = parseAnalysis({ version: 1, is_partial: true, grounding_policy: 'verified_only',
    summary: 'hidden-summary', summary_grounding_status: 'withheld', decisions: [], action_items: [], rejected_claims: ['hidden-claim'] });
  const result = analysisMarkdown(snapshot!);
  expect(result).not.toContain('hidden');
  expect(result).toContain('Gösterilebilir özet henüz yok');
});
