import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export function NewMeetingForm({ disabled, onCreate }: { disabled: boolean; onCreate(title: string): Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  async function submit() {
    if (disabled || inFlight.current || !title.trim()) return;
    inFlight.current = true; setPending(true);
    try { await onCreate(title.trim()); setTitle(''); setOpen(false); }
    catch { /* The parent displays the safe request error, retaining the entered title. */ }
    finally { inFlight.current = false; setPending(false); }
  }
  return <View>
    <Pressable accessibilityRole="button" disabled={disabled || pending} onPress={() => setOpen(!open)}>
      <Text style={styles.text}>{open ? 'Yeni toplantıyı kapat' : 'Yeni toplantı oluştur'}</Text>
    </Pressable>
    {open && <>
      <TextInput accessibilityLabel="Yeni toplantı adı" value={title} onChangeText={setTitle}
        maxLength={512} editable={!disabled && !pending} placeholder="Toplantı adı" placeholderTextColor="#94a3b8" style={styles.input} />
      <Pressable accessibilityRole="button" disabled={disabled || pending || !title.trim()} onPress={() => void submit()}>
        <Text style={styles.text}>{pending ? 'Oluşturuluyor…' : 'Toplantıyı oluştur'}</Text>
      </Pressable>
    </>}
  </View>;
}
const styles = StyleSheet.create({ text: { color: '#93c5fd', paddingVertical: 8, fontSize: 16 },
  input: { borderColor: '#64748b', borderWidth: 1, borderRadius: 6, padding: 8, color: '#fff' } });
