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
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
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

import { transcriptLineKey, type TranscriptLine } from './transcriptState';
import { SpeakerNumbering } from './speakerAttribution';

/** Anonymous labels are comparable only inside the same audio scope. */
function singleSpeaker(line: TranscriptLine): string | undefined {
  const attribution = line.speakerAttribution;
  const speaker = attribution?.turns[0]?.speaker;
  if (!speaker || speaker === 'UU' || !attribution?.turns.every(turn => turn.speaker === speaker)) return;
  return `${attribution.scope}:${speaker}`;
}

/** Presentation only: keep original sequence IDs for corrections and replay.
 * A provider's full stop ends a sentence, not necessarily a speaker paragraph.
 * In particular, do not turn "Zeynep", ".", "Sunum" into three labelled rows.
 */
export function transcriptParagraphs(lines: readonly TranscriptLine[]): TranscriptLine[][] {
  const paragraphs: TranscriptLine[][] = [];
  let current: TranscriptLine[] = [];
  let length = 0;
  for (const line of lines) {
    const previous = current.at(-1);
    if (previous && ((previous.connectionId ?? 0) !== (line.connectionId ?? 0) ||
        previous.status === 'interrupted' || line.status === 'interrupted' ||
        ((previous.speakerAttribution || line.speakerAttribution) &&
        (!singleSpeaker(line) || singleSpeaker(previous) !== singleSpeaker(line))))) {
      paragraphs.push(current);
      current = []; length = 0;
    }
    current.push(line);
    length += line.text.length;
    if ((line.status === 'final' || line.status === 'revised') && length >= 400) {
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
  header?: ReactElement;
  /** Otomatik-kaydırma özelliğini tümden kapatmak için false. Varsayılan açık. */
  autoScroll?: boolean;
}

/** Kullanıcı bu eşikten (px) daha yukarıdaysa "en altta değil" sayılır. */
const STICK_THRESHOLD_PX = 48;

export function TranscriptView({
  lines,
  header,
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
      ListHeaderComponent={header}
      ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>{t('transcript.waiting')}</Text></View>}
      keyboardShouldPersistTaps="handled"
      keyExtractor={(paragraph) => transcriptLineKey(paragraph[0])}
      contentContainerStyle={styles.content}
      onScroll={onScroll}
      onContentSizeChange={() => { if (lines.length && autoScroll && pinnedToBottom) listRef.current?.scrollToEnd({ animated: true }); }}
      scrollEventThrottle={16}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Text selectable style={styles.text}>{item.map((line, index) => (
            <Text key={transcriptLineKey(line)} style={styles[line.status]}>
              {index > 0 && !/^[,.;:!?…]/.test(line.text) ? ' ' : ''}
              {line.speakerAttribution ? line.speakerAttribution.turns.map((turn, turnIndex, turns) => {
                const speaker = speakers.number(line.speakerAttribution!.scope, turn.speaker);
                const from = turnIndex === 0 ? 0 : turns[turnIndex - 1].textEnd;
                const end = turnIndex === turns.length - 1 ? line.text.length : turn.textEnd;
                const previousTurn = turns[turnIndex - 1];
                const continued = turn.speaker !== 'UU' && (turnIndex > 0
                  ? previousTurn.speaker === turn.speaker
                  : index > 0 && singleSpeaker(item[index - 1]) === singleSpeaker(line) && !!singleSpeaker(line));
                return <Text key={turnIndex}>
                  {turnIndex > 0 && !continued ? '\n' : ''}
                  {!continued && <Text style={styles.speakerTag}>{speaker === undefined ? t('transcript.unknownSpeaker') : t('transcript.speaker', { number: speaker })}: </Text>}
                  {line.text.slice(from, end)}
                </Text>;
              }) : line.text}
            </Text>
          ))}</Text>
          {item.some(line => line.status === 'stabilizing') && <Text style={styles.revisedTag}> · {t('transcript.stabilizingTag')}</Text>}
          {item.some(line => line.status === 'revised') && <Text style={styles.revisedTag}> · {t('transcript.revisedTag')}</Text>}
          {item.some(line => line.status === 'interrupted') && <Text style={styles.revisedTag}> · {t('transcript.interruptedTag')}</Text>}
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
  interrupted: { color: '#94a3b8', fontStyle: 'italic' },
  revisedTag: { fontSize: 12, color: '#f59e0b' },
  speakerTag: { fontSize: 13, color: '#93c5fd' },
  empty: { minHeight: 160, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#64748b', fontSize: 14 },
});
