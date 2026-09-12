import type { AnalysisSnapshot } from './liveAnalysis';

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Standalone HTML: no scripts, external fonts/images, or raw server fields. */
export function analysisHtml(snapshot: AnalysisSnapshot): string {
  return `<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${snapshot.partial ? 'Toplantı analizi — canlı taslak' : 'Toplantı analizi'}</title><style>
@page { size: A4; margin: 18mm; } body { font: 12pt sans-serif; color: #172033; }
h1 { font-size: 22pt; } h2 { font-size: 16pt; margin-top: 24px; }
p, li, td { white-space: pre-wrap; overflow-wrap: anywhere; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
th, td { text-align: left; vertical-align: top; border: 1px solid #bbc2cc; padding: 8px; }
thead { display: table-header-group; } tr { break-inside: avoid; }
.notice { padding: 12px; border: 1px solid #bbc2cc; }
</style></head><body><h1>${snapshot.partial ? 'Toplantı analizi — canlı taslak' : 'Toplantı analizi'}</h1>
<p class="notice">${snapshot.partial ? 'Bu canlı taslaktır; toplantı bitince değişebilir ve kaydedilmiş nihai sonuç değildir.' : 'Son analiz çıktısı.'} Sürüm: ${snapshot.version}</p>
<h2>Özet</h2><p>${escape(snapshot.summary || 'Gösterilebilir özet henüz yok.')}</p>
<h2>Kararlar</h2>${snapshot.decisions.length ? `<ul>${snapshot.decisions.map(text => `<li>${escape(text)}</li>`).join('')}</ul>` : '<p>Henüz karar yok.</p>'}
<h2>Aksiyonlar</h2><table><thead><tr><th>Aksiyon</th><th>Sorumlu</th><th>Tarih</th></tr></thead><tbody>
${snapshot.actions.map(action => `<tr><td>${escape(action.text)}</td><td>${escape(action.owner ?? 'Belirtilmedi')}</td><td>${escape(action.dueDate ?? 'Belirtilmedi')}</td></tr>`).join('') || '<tr><td colspan="3">Henüz aksiyon yok.</td></tr>'}
</tbody></table></body></html>`;
}
