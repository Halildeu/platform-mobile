import type { AnalysisSnapshot } from './liveAnalysis';
import type { PersistedResult } from './persistedResult';

function plain(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\`*_{}\[\]()#+.!|~-])/g, '\\$1').replace(/\r?\n/g, ' ');
}

/** Export only the displayed, validated snapshot; no raw server payload or credentials. */
export function analysisMarkdown(snapshot: AnalysisSnapshot | PersistedResult): string {
  const saved = 'analysisRunId' in snapshot;
  const text = ['# Toplantı analizi', '',
    saved ? '> Kaydedilmiş toplantı sonucu.' : snapshot.partial ? '> Canlı sonuç: toplantı sürerken değişebilir.' : '> Son analiz çıktısı.',
    saved ? `Oluşturulma: ${plain(snapshot.generatedAt)}` : `Sürüm: ${snapshot.version}`, '', '## Özet', '',
    snapshot.summary ? plain(snapshot.summary) : 'Gösterilebilir özet henüz yok.', '', '## Kararlar', '',
    ...snapshot.decisions.map((decision) => `- ${plain(decision)}`),
    ...(snapshot.decisions.length ? [] : ['Henüz karar yok.']), '', '## Aksiyonlar', '',
    '| Aksiyon | Sorumlu | Tarih |', '| --- | --- | --- |',
    ...snapshot.actions.map((action) => `| ${plain(action.text)} | ${plain(action.owner ?? 'Belirtilmedi')} | ${plain(action.dueDate ?? 'Belirtilmedi')} |`),
    ...(snapshot.actions.length ? [] : ['| Henüz aksiyon yok. | — | — |']), ''];
  return text.join('\n');
}
