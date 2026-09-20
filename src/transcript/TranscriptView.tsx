/**
 * TranscriptView (PR-mobile-03, #5) — renderer half.
 *
 * Presentational: takes the `TranscriptLine[]` produced by `transcriptState`
 * and renders them in a virtualized, auto-scrolling list:
 *   draft   -> gri (tentative henüz kesinleşmedi)
 *   final   -> parlak (kesin)
 *   revised -> parlak + "· düzeltildi" işareti
 *
 * Sticky-scroll: yeni satır geldiğinde en alta kayar, AMA kullanıcı yukarı
 * kaydırdığında bu bozulmaz (manual override) — kullanıcı en alta dönene kadar
 * otomatik kaydırma askıya alınır. Metinler i18next (Türkçe varsayılan).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import type { TranscriptLine } from './transcriptState';
import { SpeakerNumbering } from './speakerAttribution';

/** Presentation only: keep original sequence IDs for corrections and replay. */
export function transcriptParagraphs(lines: readonly TranscriptLine[]): TranscriptLine[][] {
  const paragraphs: TranscriptLine[][] = [];
  let current: TranscriptLine[] = [];
  let length = 0;
  for (const line of lines) {
    if (line.speakerAttribution) {
      if (current.length) paragraphs.push(current);
      paragraphs.push([line]); current = []; length = 0;
      continue;
    }
    current.push(line);
    length += line.text.length;
    if ((line.status === 'final' || line.status === 'revised') && (/[.!?…][”"')]*$/.test(line.text.trim()) || length >= 400)) {
      paragraphs.push(current);
      current = [];
      length = 0;
    }
  }
  if (current.length) paragraphs.push(current);
  return paragraphs;
}

export interface TranscriptViewProps {
  lines: readonly TranscriptLine[];
  /** Otomatik-kaydırma özelliğini tümden kapatmak için false. Varsayılan açık. */
  autoScroll?: boolean;
}

/** Kullanıcı bu eşikten (px) daha yukarıdaysa "en altta değil" sayılır. */
const STICK_THRESHOLD_PX = 48;

export function TranscriptView({
  lines,
  autoScroll = true,
}: TranscriptViewProps) {
  const { t } = useTranslation();
  const listRef = useRef<FlatList<TranscriptLine[]>>(null);
  const paragraphs = transcriptParagraphs(lines);
  const [speakers] = useState(() => new SpeakerNumbering());
  // Kullanıcı en altta "yapışık" mı — yukarı kaydırınca false olur, geri dönünce true.
  const [pinnedToBottom, setPinnedToBottom] = useState(true);

  useEffect(() => {
    if (autoScroll && pinnedToBottom && lines.length > 0) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [lines, autoScroll, pinnedToBottom]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const distanceFromBottom =
        contentSize.height - (contentOffset.y + layoutMeasurement.height);
      setPinnedToBottom(distanceFromBottom <= STICK_THRESHOLD_PX);
    },
    [],
  );

  if (lines.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{t('transcript.waiting')}</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
    {lines.some(line => line.speakerAttribution) && <Text style={styles.speakerTag}>{t('transcript.speakerNotice')}</Text>}
    {autoScroll && !pinnedToBottom && <Pressable accessibilityRole="button" onPress={() => {
      setPinnedToBottom(true); listRef.current?.scrollToEnd({ animated: true });
    }}><Text style={styles.revisedTag}>{t('transcript.followLatest')}</Text></Pressable>}
    <FlatList
      testID="transcript-list"
      ref={listRef}
      data={paragraphs}
      keyExtractor={(paragraph) => String(paragraph[0].seq)}
      contentContainerStyle={styles.content}
      onScroll={onScroll}
      onContentSizeChange={() => { if (autoScroll && pinnedToBottom) listRef.current?.scrollToEnd({ animated: true }); }}
      scrollEventThrottle={16}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Text selectable style={styles.text}>{item.map((line, index) => (
            <Text key={line.seq} style={styles[line.status]}>
              {index > 0 && !/^[,.;:!?…]/.test(line.text) ? ' ' : ''}
              {line.speakerAttribution ? line.speakerAttribution.turns.map((turn, turnIndex, turns) => {
                const speaker = speakers.number(line.speakerAttribution!.scope, turn.speaker);
                const from = turnIndex === 0 ? 0 : turns[turnIndex - 1].textEnd;
                const end = turnIndex === turns.length - 1 ? line.text.length : turn.textEnd;
                return <Text key={turnIndex}>
                  {turnIndex > 0 ? '\n' : ''}
                  <Text style={styles.speakerTag}>{speaker === undefined ? t('transcript.unknownSpeaker') : t('transcript.speaker', { number: speaker })}: </Text>
                  {line.text.slice(from, end)}
                </Text>;
              }) : line.text}
            </Text>
          ))}</Text>
          {item.some(line => line.status === 'stabilizing') && <Text style={styles.revisedTag}> · {t('transcript.stabilizingTag')}</Text>}
          {item.some(line => line.status === 'revised') && <Text style={styles.revisedTag}> · {t('transcript.revisedTag')}</Text>}
        </View>
      )}
    />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline' },
  text: { fontSize: 16, lineHeight: 22 },
  draft: { color: '#64748b', fontStyle: 'italic' },
  stabilizing: { color: '#94a3b8' },
  final: { color: '#e2e8f0' },
  revised: { color: '#e2e8f0' },
  revisedTag: { fontSize: 12, color: '#f59e0b' },
  speakerTag: { fontSize: 13, color: '#93c5fd' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#64748b', fontSize: 14 },
});
