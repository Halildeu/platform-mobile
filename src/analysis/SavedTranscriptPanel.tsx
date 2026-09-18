import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import { persistedResult, savedTranscript } from '../audio/liveTestApi';

async function loadTranscript(meetingId: string) {
  const result = await persistedResult(meetingId);
  return savedTranscript(meetingId, result.analysisRunId);
}

type Props = { meetingId: string; load?: (meetingId: string) => Promise<string> };
export function SavedTranscript(props: Props) {
  return <TranscriptForMeeting key={props.meetingId} {...props} />;
}
function TranscriptForMeeting({ meetingId, load = loadTranscript }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    void load(meetingId).then(value => { if (current) setText(value); })
      .catch(() => { if (current) setError(true); });
    return () => { current = false; };
  }, [meetingId, load, attempt]);
  return <ScrollView style={{ flex: 1 }}>
    {!error && text === null && <Text style={{ color: '#94a3b8' }}>Kaydedilmiş konuşma metni yükleniyor…</Text>}
    {error && <>
      <Text accessibilityRole="alert" style={{ color: '#e2e8f0' }}>Kaydedilmiş konuşma metni alınamadı. Sonuç henüz hazır olmayabilir veya erişim sağlanamıyor.</Text>
      <Pressable accessibilityRole="button" onPress={() => { setError(false); setText(null); setAttempt(value => value + 1); }}>
        <Text style={{ color: '#93c5fd', paddingVertical: 12 }}>Yeniden dene</Text>
      </Pressable>
    </>}
    {text !== null && <Text selectable style={{ color: '#e2e8f0', fontSize: 16 }}>{text || 'Bu sonuçta konuşma metni boş.'}</Text>}
  </ScrollView>;
}
