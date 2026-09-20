import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { persistedResult, savedTranscript } from '../audio/liveTestApi';
import { mobileSession } from '../auth/mobileSession';
import { useResultExport } from './useResultExport';
import { transcriptHtml } from './exportHtml';
import { type SavedTranscriptDocument } from './savedTranscript';
import { SavedSpeakerTranscript } from './SavedSpeakerTranscript';

async function loadTranscript(meetingId: string) {
  const result = await persistedResult(meetingId);
  return savedTranscript(meetingId, result.analysisRunId);
}

type Props = { meetingId: string; load?: (meetingId: string) => Promise<SavedTranscriptDocument> };
export function SavedTranscript(props: Props) {
  return <TranscriptForMeeting key={props.meetingId} {...props} />;
}
function TranscriptForMeeting({ meetingId, load = loadTranscript }: Props) {
  const [document, setDocument] = useState<SavedTranscriptDocument | null>(null);
  const text = document?.text ?? null;
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [scope, setScope] = useState<number | null>(null);
  const exports = useResultExport(scope);
  useEffect(() => {
    let current = true;
    const owner = mobileSession.contentScope();
    void load(meetingId).then(value => {
      if (!current) return;
      if (owner === null || owner !== mobileSession.contentScope() || value.meetingId !== meetingId) { setError(true); return; }
      setScope(owner); setDocument(value);
    })
      .catch(() => { if (current) setError(true); });
    return () => { current = false; };
  }, [meetingId, load, attempt]);
  return <View style={{ flex: 1 }}>
    {!error && text === null && <Text style={{ color: '#94a3b8' }}>Kaydedilmiş konuşma metni yükleniyor…</Text>}
    {error && <>
      <Text accessibilityRole="alert" style={{ color: '#e2e8f0' }}>Kaydedilmiş konuşma metni alınamadı. Sonuç henüz hazır olmayabilir veya erişim sağlanamıyor.</Text>
      <Pressable accessibilityRole="button" onPress={() => { setError(false); setDocument(null); setAttempt(value => value + 1); }}>
        <Text style={{ color: '#93c5fd', paddingVertical: 12 }}>Yeniden dene</Text>
      </Pressable>
    </>}
    {text === '' && <Text style={{ color: '#e2e8f0' }}>Bu sonuçta konuşma metni boş.</Text>}
    {!!text && <>
      <Pressable accessibilityRole="button" disabled={exports.working} onPress={() => void exports.copy(text)}>
        <Text style={{ color: '#93c5fd', paddingVertical: 12 }}>Metnin tamamını kopyala</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={exports.working} onPress={() => void exports.pdf(transcriptHtml(text))}>
        <Text style={{ color: '#93c5fd', paddingVertical: 12 }}>Kaydedilmiş metni PDF olarak paylaş</Text>
      </Pressable>
    </>}
    {!!exports.message && <Text accessibilityRole="alert" style={{ color: '#e2e8f0' }}>{exports.message}</Text>}
    {document && <SavedSpeakerTranscript key={document.analysisRunId + ':' + scope + ':' + attempt}
      document={document} owner={scope} />}
  </View>;
}
