import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { mobileSession } from '../auth/mobileSession';
import { processingStatus, recordingChoices } from '../audio/liveTestApi';
import { ProcessingStatusReadError, processingStatusMessages, type ProcessingStatus, type RecordingChoice } from './processingStatus';

type Props = {
  meetingId: string;
  loadChoices?: typeof recordingChoices;
  loadStatus?: typeof processingStatus;
};
const expired = 'Oturum değişti; kayıt durumunu yeniden açın.';
export function statusTime(value: string): string {
  const date = new Date(value);
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 19)} (UTC)`;
}
export function recordingChoiceLabel(row: RecordingChoice, index: number): string {
  return `Kayıt ${index + 1} · ${row.startedAt ? 'Başlangıç' : 'Oluşturulma'}: ${statusTime(row.startedAt ?? row.createdAt)}`;
}

export function ProcessingStatusPanel(props: Props) {
  const [, renderAgain] = useState(0);
  // App re-entry also drops a result whose account expired while in the background.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', () => renderAgain(value => value + 1));
    return () => subscription.remove();
  }, []);
  const owner = mobileSession.contentScope();
  return <StatusForMeeting key={`${props.meetingId}:${owner}`} {...props} owner={owner} />;
}

function StatusForMeeting({ meetingId, owner, loadChoices = recordingChoices, loadStatus = processingStatus }: Props & { owner: number | null }) {
  const [opened, setOpened] = useState(false);
  const [choices, setChoices] = useState<RecordingChoice[]>([]);
  const [visible, setVisible] = useState(20);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<ProcessingStatus | null>(null);
  const [busy, setBusy] = useState<'list' | 'status' | null>(null);
  const [error, setError] = useState('');
  const request = useRef({ generation: 0, pendingList: false });
  useEffect(() => {
    const current = request.current;
    return () => { current.generation++; };
  }, []);
  function current(generation: number): boolean {
    if (request.current.generation !== generation) return false;
    if (owner !== null && mobileSession.contentScope() === owner) return true;
    request.current.generation++; request.current.pendingList = false;
    setStatus(null); setChoices([]); setSelected(null); setBusy(null); setError(expired);
    return false;
  }
  async function open() {
    if (request.current.pendingList) return;
    const generation = ++request.current.generation;
    setOpened(true); setStatus(null); setChoices([]); setSelected(null); setVisible(20); setError('');
    if (!current(generation) || owner === null) return;
    request.current.pendingList = true; setBusy('list');
    try {
      const next = await loadChoices(meetingId, owner);
      if (!current(generation)) return;
      if (next.some(row => row.meetingId !== meetingId)) throw new Error('Kayıt listesi toplantıyla eşleşmiyor.');
      setChoices(next);
    } catch (error) {
      if (current(generation)) setError(error instanceof ProcessingStatusReadError ? error.message : 'Kayıt listesi alınamadı. Yeniden deneyebilirsiniz.');
    } finally {
      if (current(generation)) { request.current.pendingList = false; setBusy(null); }
    }
  }
  async function select(sessionId: string) {
    const generation = ++request.current.generation;
    setStatus(null); setError(''); setSelected(sessionId);
    if (!current(generation) || owner === null) return;
    setBusy('status');
    try {
      const next = await loadStatus(meetingId, sessionId, owner);
      if (!current(generation)) return;
      if (next.meetingId !== meetingId || next.sessionId !== sessionId) throw new Error('Kayıt eşleşmedi.');
      setStatus(next);
    } catch (error) {
      if (current(generation)) setError(error instanceof ProcessingStatusReadError ? error.message : 'Kayıt durumu doğrulanamadı. Yeniden deneyebilirsiniz.');
    } finally { if (current(generation)) setBusy(null); }
  }
  return <View style={styles.panel}>
    <Pressable accessibilityRole="button" disabled={busy === 'list'} onPress={() => void open()}>
      <Text style={styles.link}>{busy === 'list' ? 'Kayıtlar okunuyor…' : opened ? 'Kayıt listesini yenile' : 'Kayıt durumunu kontrol et'}</Text>
    </Pressable>
    {opened && <>
      <Text style={styles.text}>Durumunu görmek istediğiniz kaydı seçin. Bu kontrol kaydı başlatmaz veya kapatmaz.</Text>
      {choices.slice(0, visible).map((row, index) => <Pressable key={row.id} accessibilityRole="button"
        accessibilityState={{ selected: selected === row.id }} onPress={() => void select(row.id)}>
        <Text style={[styles.link, selected === row.id && styles.selected]}>{recordingChoiceLabel(row, index)}</Text>
      </Pressable>)}
      {choices.length > visible && <Pressable accessibilityRole="button" onPress={() => setVisible(value => value + 20)}>
        <Text style={styles.link}>Daha eski kayıtları göster</Text>
      </Pressable>}
      {!busy && !error && choices.length === 0 && <Text style={styles.text}>Bu toplantıda seçilebilir kayıt bulunmuyor.</Text>}
      {selected && <Pressable accessibilityRole="button" disabled={busy !== null} onPress={() => void select(selected)}>
        <Text style={styles.link}>{busy === 'status' ? 'Kayıt durumu okunuyor…' : 'Seçili kaydın durumunu yenile'}</Text>
      </Pressable>}
      {!!error && <Text accessibilityRole="alert" style={styles.text}>{error}</Text>}
      {status && <View style={styles.status}>
        <Text style={styles.title}>Seçili kaydın durumu</Text>
        {processingStatusMessages(status).map(message => <Text key={message} style={styles.text}>{message}</Text>)}
        <Text style={styles.note}>Metin durumu kontrolü: {statusTime(status.source.observedAt)}</Text>
        <Text style={styles.note}>Kaydedilmiş sonuç kontrolü: {statusTime(status.savedResult.observedAt)}</Text>
        <Text style={styles.note}>Bu bilgiler son kontrol anına aittir; kendiliğinden yenilenmez.</Text>
      </View>}
    </>}
  </View>;
}
const styles = StyleSheet.create({ panel: { gap: 10 }, status: { gap: 10, borderLeftColor: '#93c5fd', borderLeftWidth: 2, paddingLeft: 12 },
  text: { color: '#e2e8f0', fontSize: 15 }, title: { color: '#fff', fontSize: 17, fontWeight: '600' },
  note: { color: '#cbd5e1', fontSize: 13 }, link: { color: '#93c5fd', paddingVertical: 12, fontSize: 16 },
  selected: { color: '#fff', fontWeight: '700' } });
