import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { savedTranscript } from '../audio/liveTestApi';

export function SavedTranscript({ meetingId, analysisRunId, load = savedTranscript }: {
  meetingId: string; analysisRunId: string; load?: (meeting: string, run: string) => Promise<string>;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const pending = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function open() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setText(null); setError('');
    try {
      const value = await load(meetingId, analysisRunId);
      if (alive.current) setText(value);
    } catch { if (alive.current) setError('Kaydedilen konuşma metni okunamadı. Erişim, saklama süresi veya sunucu durumu kontrol edilmeli.'); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  return <View>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void open()}>
      <Text style={{ color: '#93c5fd', paddingVertical: 12 }}>{busy ? 'Konuşma metni okunuyor…' : 'Kaydedilen konuşma metnini aç'}</Text>
    </Pressable>
    {!!error && <Text accessibilityRole="alert" style={{ color: '#e2e8f0' }}>{error}</Text>}
    {text !== null && <Text selectable style={{ color: '#e2e8f0' }}>{text || 'Bu sonuçta konuşma metni boş.'}</Text>}
  </View>;
}
