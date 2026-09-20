export function parseSavedTranscript(value: unknown, meetingId: string, analysisRunId: string): string {
  if (!value || typeof value !== 'object') throw new Error('Konuşma metni doğrulanamadı.');
  const p = value as Record<string, unknown>;
  if (p.meetingId !== meetingId || p.analysisRunId !== analysisRunId ||
      typeof p.transcript !== 'string' || p.transcript.length > 5000000 ||
      typeof p.transcriptSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(p.transcriptSha256))
    throw new Error('Konuşma metni seçilen sonuçla eşleşmiyor.');
  return p.transcript;
}
