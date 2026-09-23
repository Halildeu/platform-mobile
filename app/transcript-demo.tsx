/**
 * Canlı transkript DEMO ekrani (PR-mobile-03, #5).
 *
 * Gercek ses/WS/auth zinciri olmadan, scripted ws-stream olaylarini zamanlayarak
 * transcriptState + TranscriptView'i telefonda gosterir: taslak(gri) -> final(siyah)
 * -> revised(duzeltildi). Ses hatti (PR-mobile-02) baglaninca ayni bilesenler
 * gercek olaylarla beslenecek.
 */
import { useEffect, useReducer, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import type {
  WsFinalEvent,
  WsPartialEvent,
  WsStreamEvent,
} from '../src/contracts/wsStreamEvents';
import {
  applyTranscriptEvent,
  initialTranscriptState,
} from '../src/transcript/transcriptState';
import { TranscriptView } from '../src/transcript/TranscriptView';

function p(seq: number, confirmed: string, tentative: string): WsPartialEvent {
  return { type: 'partial', seq, confirmed, tentative, elapsed_ms: 10, rms: 0.05, source: 'demo' };
}
function f(seq: number, text: string): WsFinalEvent {
  return { type: 'final', seq, text, reason: 'silence', elapsed_ms: 20, rms: 0.05 };
}

// [gecikme ms, olay] — kumulatif zamanlanir.
const SCRIPT: [number, WsStreamEvent][] = [
  [500, p(0, 'Bugünkü toplantıyı', 'Halil')],
  [500, p(0, 'Bugünkü toplantıyı Halil Koçoğlu', 'açtı')],
  [500, f(0, 'Bugünkü toplantıyı Halil Koçoğlu açtı.')],
  [700, p(1, 'Birinci kararımız', 'konfigürasyon')],
  [500, p(1, 'Birinci kararımız konfigürasyon çalışma kağıtları', 'Cuma')],
  [500, f(1, 'Birinci kararımız: konfigürasyon çalışma kağıtları Cuma’ya kadar bitirilecek.')],
  [700, p(2, 'İkinci kararımız', 'belge talebi')],
  [500, f(2, 'İkinci kararımız: eksik dosyalar için belge talebi gönderilecek.')],
  [700, p(3, 'Üçüncü kararımız Salı', 'saat 10')],
  [500, f(3, 'Üçüncü kararımız: Salı saat 10’da toplantı.')],
  [900, f(3, 'Üçüncü kararımız: Salı saat 14’te değerlendirme toplantısı.')],
];

// Reproduce provider-sized finals, including standalone punctuation, in the real renderer.
const WORD_SCRIPT: [number, WsStreamEvent][] = ['Zeynep', '.', 'Sunum', 'dosyasını', 'hazırlayacak', '.',
  'Mehmet', '.', 'Bütçe', 'tablosunu', 'kontrol', 'edecek', '.'].map((text, seq) => [150, {
  ...f(seq, text), speakerAttribution: { scope: '12345678-1234-3234-8234-123456789012',
    turns: [{ speaker: 'S1', textStart: 0, textEnd: text.length, startMs: 0, endMs: 100 }] },
}]);

export default function TranscriptDemoScreen() {
  const [run, setRun] = useState(0);
  const { scenario } = useLocalSearchParams<{ scenario?: string }>();
  return <DemoRun key={`${run}-${scenario}`} script={scenario === 'word-fragments' ? WORD_SCRIPT : SCRIPT}
    restart={() => setRun((value) => value + 1)} />;
}

function DemoRun({ restart, script }: { restart: () => void; script: [number, WsStreamEvent][] }) {
  const [state, dispatch] = useReducer(applyTranscriptEvent, undefined, initialTranscriptState);

  useEffect(() => {
    // her "run" degisiminde bastan oynat
    const timers: ReturnType<typeof setTimeout>[] = [];
    let t = 0;
    for (const [delay, event] of script) {
      t += delay;
      timers.push(setTimeout(() => dispatch(event), t));
    }
    return () => timers.forEach(clearTimeout);
  }, [script]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Canlı Transkript — Demo</Text>
        <Pressable testID="restart-transcript-demo" style={styles.button} onPress={restart}>
          <Text style={styles.buttonText}>Baştan oynat</Text>
        </Pressable>
      </View>
      <TranscriptView lines={state.lines} />
      <Text style={styles.legend}>
        gri = taslak · beyaz = final · sarı “düzeltildi” = revize
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', paddingTop: 12 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  title: { fontSize: 18, fontWeight: '600', color: '#e2e8f0' },
  button: { backgroundColor: '#2563eb', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  buttonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  legend: { color: '#64748b', fontSize: 12, textAlign: 'center', padding: 10 },
});
