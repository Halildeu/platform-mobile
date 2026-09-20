import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { mobileSession } from '../auth/mobileSession';
import { savedSpeakerLabels } from '../audio/liveTestApi';
import { savedTranscriptRows, type SavedTranscriptDocument } from './savedTranscript';
import { normalizeSpeakerName, speakerKey, validSpeakerDocument, type SpeakerKey, type SpeakerLabels } from './speakerLabels';

type Props = { document: SavedTranscriptDocument; owner: number | null; api?: typeof savedSpeakerLabels };
export function SavedSpeakerTranscript(props: Props) {
  return <SpeakerTranscriptForOccurrence key={props.document.meetingId + ':' + props.document.analysisRunId + ':' + props.owner} {...props} />;
}
function SpeakerTranscriptForOccurrence({ document, owner, api = savedSpeakerLabels }: Props) {
  const rows = useMemo(() => savedTranscriptRows(document), [document]);
  const [labels, setLabels] = useState<SpeakerLabels | null>(null);
  const [editing, setEditing] = useState<SpeakerKey | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const generation = useRef<{ active: boolean } | null>(null), locked = useRef(false);
  const hasSpeakers = rows.some(row => row.speakerKey);
  useEffect(() => {
    const currentGeneration = { active: true };
    generation.current = currentGeneration;
    const current = () => currentGeneration.active && generation.current === currentGeneration && owner !== null && mobileSession.contentScope() === owner;
    if (hasSpeakers && owner !== null && validSpeakerDocument(document)) {
      void api(document, owner).then(value => { if (current()) setLabels(value); })
        .catch(() => { if (current()) setMessage('Konuşmacı adları şu an yüklenemedi. Tam metin kullanılabilir.'); });
    }
    return () => { currentGeneration.active = false; };
  }, [api, document, owner, hasSpeakers]);

  const labelFor = (key: SpeakerKey) => labels?.labels.find(label => speakerKey(label) === speakerKey(key))?.name;
  async function save(remove: boolean) {
    if (!editing || !labels?.editable || owner === null || locked.current || mobileSession.contentScope() !== owner) return;
    let normalized: string | null;
    try { normalized = remove ? null : normalizeSpeakerName(name); }
    catch { setMessage('Ad 1–80 karakter olmalı; satır sonu veya kontrol karakteri içermemeli.'); return; }
    const currentGeneration = generation.current;
    const current = () => !!currentGeneration?.active && generation.current === currentGeneration && mobileSession.contentScope() === owner;
    locked.current = true; setBusy(true); setMessage('');
    const edit = { ...editing, name: normalized, expectedRevision: labels.revision };
    try {
      const result = await api(document, owner, edit);
      if (current()) { setLabels(result); setEditing(null); setName(''); setMessage(remove ? 'Konuşmacı adı kaldırıldı.' : 'Konuşmacı adı kaydedildi.'); }
    } catch {
      // A lost response may follow a committed write. Read back; never overwrite with a guessed new revision.
      if (current()) {
        setLabels(null); setEditing(null); setName('');
        try {
          const latest = await api(document, owner);
          if (current()) { setLabels(latest); setMessage('İşlem sonucu kesinleştirilemedi. Sunucudaki güncel adlar yüklendi; kontrol edip yeniden düzenleyebilirsiniz.'); }
        } catch { if (current()) setMessage('Konuşmacı adı doğrulanamadı. Toplantıyı yeniden açıp güncel adları kontrol edin.'); }
      }
    } finally { locked.current = false; if (current()) setBusy(false); }
  }
  return <View style={{ flex: 1 }}>
    {hasSpeakers && <Text style={{ color: '#94a3b8' }}>Konuşmacı numaraları bu kayıt içindir; kişi kimliği değildir. Verdiğiniz ad bu kayda uygulanır.</Text>}
    {!!message && <Text accessibilityRole="alert" style={{ color: '#e2e8f0' }}>{message}</Text>}
    {editing && <View>
      <TextInput accessibilityLabel="Konuşmacı adı" value={name} onChangeText={setName} editable={!busy}
        maxLength={160} autoCorrect={false} style={{ color: '#e2e8f0', borderColor: '#93c5fd', borderWidth: 1, padding: 12 }} />
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void save(false)}><Text style={{ color: '#93c5fd', padding: 12 }}>Adı kaydet</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void save(true)}><Text style={{ color: '#93c5fd', padding: 12 }}>Adı kaldır</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setEditing(null); setName(''); }}><Text style={{ color: '#93c5fd', padding: 12 }}>Vazgeç</Text></Pressable>
    </View>}
    <FlatList data={rows} keyExtractor={(_, index) => String(index)} initialNumToRender={4} windowSize={5}
      renderItem={({ item }) => <View>
        {item.speaker !== undefined && <Text style={{ color: '#93c5fd' }}>
          {item.speaker === 'unknown' ? 'Konuşmacı bilinmiyor' : (item.speakerKey && labelFor(item.speakerKey)) ?? `Konuşmacı ${item.speaker}`}
        </Text>}
        {item.speakerKey && labels?.editable && <Pressable accessibilityRole="button" disabled={busy}
          accessibilityLabel={`Konuşmacı ${item.speaker} adını düzenle`}
          onPress={() => {
            if (owner === null || mobileSession.contentScope() !== owner) return;
            setEditing(item.speakerKey!); setName(labelFor(item.speakerKey!) ?? ''); setMessage('');
          }}><Text style={{ color: '#93c5fd', paddingVertical: 8 }}>Adı düzenle</Text></Pressable>}
        <Text selectable style={{ color: '#e2e8f0', fontSize: 16 }}>{item.text}</Text>
      </View>} />
  </View>;
}
