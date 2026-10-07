import { useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { mobileSession } from '../auth/mobileSession';
import { savedSpeakerLabels } from '../audio/liveTestApi';
import { savedTranscriptRows, type SavedTranscriptDocument, type SavedTranscriptRow } from './savedTranscript';
import { normalizeSpeakerName, speakerKey, validSpeakerDocument, type SpeakerKey, type SpeakerLabels } from './speakerLabels';

type Props = { document: SavedTranscriptDocument | null; owner: number | null; rows?: SavedTranscriptRow[];
  header?: ReactElement; viewKey?: string; api?: typeof savedSpeakerLabels };
export function SavedSpeakerTranscript(props: Props) {
  return <SpeakerTranscriptForOccurrence key={props.viewKey ?? props.document?.meetingId + ':' + props.document?.analysisRunId + ':' + props.owner} {...props} />;
}
function SpeakerTranscriptForOccurrence({ document, owner, header, rows: projectedRows, api = savedSpeakerLabels }: Props) {
  const rows = useMemo(() => projectedRows ?? (document ? savedTranscriptRows(document) : []), [document, projectedRows]);
  const [labels, setLabels] = useState<SpeakerLabels | null>(null);
  const [editTarget, setEditTarget] = useState<{ key: SpeakerKey; index: number; rows: SavedTranscriptRow[] } | null>(null);
  const editing = editTarget?.rows === rows ? editTarget.key : null;
  const editingRow = editing ? editTarget!.index : null;
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const generation = useRef<{ active: boolean; locked: boolean } | null>(null);
  const occurrenceKey = JSON.stringify([owner, document?.meetingId, document?.analysisRunId,
    document?.sessionId, document?.finalizationVersion, document?.transcriptSha256]);
  const [stateOccurrence, setStateOccurrence] = useState(occurrenceKey);
  if (stateOccurrence !== occurrenceKey) {
    // Reset only speaker state before children render; remounting the list would
    // erase an in-progress meeting title in its header when the document loads.
    setStateOccurrence(occurrenceKey); setLabels(null); setEditTarget(null);
    setName(''); setBusy(false); setMessage('');
  }
  const hasSpeakers = rows.some(row => row.speakerKey);
  const loadLabels = useEffectEvent((currentGeneration: { active: boolean; locked: boolean }) => {
    const current = () => currentGeneration.active && generation.current === currentGeneration && owner !== null && mobileSession.contentScope() === owner;
    if (hasSpeakers && document && owner !== null && validSpeakerDocument(document)) {
      void api(document, owner).then(value => { if (current()) setLabels(value); })
        .catch(() => { if (current()) setMessage('Konuşmacı adları şu an yüklenemedi. Tam metin kullanılabilir.'); });
    }
  });
  useLayoutEffect(() => {
    const currentGeneration = { active: true, locked: false };
    generation.current = currentGeneration;
    loadLabels(currentGeneration);
    return () => { currentGeneration.active = false; };
  }, [api, occurrenceKey, hasSpeakers]);

  const labelFor = (key: SpeakerKey) => labels?.labels.find(label => speakerKey(label) === speakerKey(key))?.name;
  async function save(remove: boolean) {
    const currentGeneration = generation.current;
    if (!document || !editing || !labels?.editable || owner === null || !currentGeneration?.active
      || currentGeneration.locked || mobileSession.contentScope() !== owner) return;
    let normalized: string | null;
    try { normalized = remove ? null : normalizeSpeakerName(name); }
    catch { setMessage('Ad 1–80 karakter olmalı; satır sonu veya kontrol karakteri içermemeli.'); return; }
    const current = () => !!currentGeneration?.active && generation.current === currentGeneration && mobileSession.contentScope() === owner;
    currentGeneration.locked = true; setBusy(true); setMessage('');
    const edit = { ...editing, name: normalized, expectedRevision: labels.revision };
    try {
      const result = await api(document, owner, edit);
      if (current()) { setLabels(result); setEditTarget(null); setName(''); setMessage(remove ? 'Konuşmacı adı kaldırıldı.' : 'Konuşmacı adı kaydedildi.'); }
    } catch {
      // A lost response may follow a committed write. Read back; never overwrite with a guessed new revision.
      if (current()) {
        setLabels(null); setEditTarget(null); setName('');
        try {
          const latest = await api(document, owner);
          if (current()) { setLabels(latest); setMessage('İşlem sonucu kesinleştirilemedi. Sunucudaki güncel adlar yüklendi; kontrol edip yeniden düzenleyebilirsiniz.'); }
        } catch { if (current()) setMessage('Konuşmacı adı doğrulanamadı. Toplantıyı yeniden açıp güncel adları kontrol edin.'); }
      }
    } finally { currentGeneration.locked = false; if (current()) setBusy(false); }
  }
  const controls = <View style={{ gap: 8 }}>
    {header}
    {hasSpeakers && <Text style={{ color: '#94a3b8' }}>Konuşmacı numaraları bu kayıt içindir; kişi kimliği değildir. Verdiğiniz ad bu kayda uygulanır.</Text>}
    {!!message && <Text accessibilityRole="alert" style={{ color: '#e2e8f0' }}>{message}</Text>}
  </View>;
  const editor = editing && <View testID="speaker-name-editor">
      <TextInput accessibilityLabel="Konuşmacı adı" value={name} onChangeText={setName} editable={!busy}
        maxLength={160} autoCorrect={false} autoFocus style={{ color: '#e2e8f0', borderColor: '#93c5fd', borderWidth: 1, padding: 12 }} />
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void save(false)}><Text style={{ color: '#93c5fd', padding: 12 }}>Adı kaydet</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void save(true)}><Text style={{ color: '#93c5fd', padding: 12 }}>Adı kaldır</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setEditTarget(null); setName(''); }}><Text style={{ color: '#93c5fd', padding: 12 }}>Vazgeç</Text></Pressable>
    </View>;
  return <FlatList style={{ flex: 1 }} testID="saved-transcript-list" data={rows}
      ListHeaderComponent={controls} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
      keyExtractor={(_, index) => String(index)} initialNumToRender={4} windowSize={5}
      renderItem={({ item, index }) => <View testID={`saved-transcript-row-${index}`}>
        {item.speaker !== undefined && <Text style={{ color: '#93c5fd' }}>
          {item.speaker === 'unknown' ? 'Konuşmacı bilinmiyor' : (item.speakerKey && labelFor(item.speakerKey)) ?? `Konuşmacı ${item.speaker}`}
        </Text>}
        {item.speakerKey && labels?.editable && <Pressable accessibilityRole="button" disabled={busy}
          accessibilityLabel={`Konuşmacı ${item.speaker} adını düzenle`}
          onPress={() => {
            if (owner === null || mobileSession.contentScope() !== owner) return;
            setEditTarget({ key: item.speakerKey!, index, rows }); setName(labelFor(item.speakerKey!) ?? ''); setMessage('');
          }}><Text style={{ color: '#93c5fd', paddingVertical: 8 }}>Adı düzenle</Text></Pressable>}
        {editingRow === index && editor}
        <Text selectable style={{ color: '#e2e8f0', fontSize: 16 }}>{item.text}</Text>
      </View>} />;
}
