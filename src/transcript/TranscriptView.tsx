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
  const listRef = useRef<FlatList<TranscriptLine>>(null);
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
    {autoScroll && !pinnedToBottom && <Pressable accessibilityRole="button" onPress={() => {
      setPinnedToBottom(true); listRef.current?.scrollToEnd({ animated: true });
    }}><Text style={styles.revisedTag}>{t('transcript.followLatest')}</Text></Pressable>}
    <FlatList
      testID="transcript-list"
      ref={listRef}
      data={lines as TranscriptLine[]}
      keyExtractor={(line) => String(line.seq)}
      contentContainerStyle={styles.content}
      onScroll={onScroll}
      onContentSizeChange={() => { if (autoScroll && pinnedToBottom) listRef.current?.scrollToEnd({ animated: true }); }}
      scrollEventThrottle={16}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Text style={[styles.text, styles[item.status]]}>{item.text}</Text>
          {item.status === 'stabilizing' && <Text style={styles.revisedTag}> · {t('transcript.stabilizingTag')}</Text>}
          {item.status === 'revised' ? (
            <Text style={styles.revisedTag}> · {t('transcript.revisedTag')}</Text>
          ) : null}
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
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#64748b', fontSize: 14 },
});
