import { useEffect, useState } from 'react';
import { Alert, AppState, Linking, Pressable, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { disableNativePush, enableNativePush, nativePushConfiguration, refreshNativePush, rotateNativePush } from './nativePush';

export function NativePushSettings({ disabled }: { disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Özet ve görev güncellemeleri için bildirimleri açabilirsiniz.');
  useEffect(() => {
    if (!nativePushConfiguration()) return;
    let alive = true;
    const refresh = () => { void refreshNativePush().catch(() => {
      if (alive) setMessage('Bildirim kaydı yenilenemedi. Bağlantınızı kontrol edin.');
    }); };
    refresh();
    const app = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    const token = Notifications.addPushTokenListener(device => { void rotateNativePush(device).catch(() => {
      if (alive) setMessage('Bildirim kaydı yenilenemedi. Bağlantınızı kontrol edin.');
    }); });
    return () => { alive = false; app.remove(); token.remove(); };
  }, []);
  async function change(enable: boolean) {
    setBusy(true);
    try {
      if (enable) { await enableNativePush(); setMessage('Bildirim kaydı açıldı.'); }
      else setMessage(await disableNativePush() ? 'Bildirim kaydı kapatıldı.' : 'Sunucu kaydı temizlenemedi; bağlantı kurulunca yeniden kapatmayı deneyin.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Bildirim işlemi tamamlanamadı.'); }
    finally { setBusy(false); }
  }
  const text = { color: '#cbd5e1', padding: 8 };
  if (!nativePushConfiguration()) return <Text style={text}>Bildirimler henüz kullanıma açılmadı.</Text>;
  return <View>
    <Text accessibilityLiveRegion="polite" style={text}>{message}</Text>
    <Pressable accessibilityRole="button" disabled={disabled || busy} onPress={() => Alert.alert('Toplantı bildirimleri',
      'Toplantı özeti ve görevler hazır olduğunda bildirim alırsınız. Bildirimde konuşma içeriği gösterilmez.',
      [{ text: 'Vazgeç' }, { text: 'İzin ver', onPress: () => void change(true) }])}><Text style={text}>Bildirimleri aç</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={disabled || busy} onPress={() => void change(false)}><Text style={text}>Bildirimleri kapat</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()}><Text style={text}>Telefon bildirim ayarları</Text></Pressable>
  </View>;
}
