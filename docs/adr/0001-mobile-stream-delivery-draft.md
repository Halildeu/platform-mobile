# Taslak: mobil ses teslimi ve arka plan kaydı

Durum: Yerel PoC; kabul edilmiş mimari karar değildir. 2026-09-08.

## Karar sınırı

Mevcut ön plan ses akışı korunur. WS gönderim başarısı kalıcı teslim sayılmaz.
Tampon çekirdeği yalnız aynı sessionId/chunkSeq için doğrulanmış teslim makbuzuyla siler.
Gateway REST kabulü ile WS aktarımı ayrı durumları tuttuğundan iki yolun birleştirilmesi
sunucuyla uzlaştırılmış tekrar işleme sözleşmesi olmadan etkinleştirilmez.

Kalıcı ses tamponu varsayılan olarak kapalıdır. Politika sahibinin saklama süresi
olmadan açılmaz; SQLCipher desteği olmayan derlemede şifresiz tabloya düşmez.
KVKK ADR 0030'un saklama, onay ve inceleme koşulları geçerlidir. Anahtar kaybı,
hesap değişimi, süre dolumu, uygulama yeniden açılışı ve veritabanı temizliği cihazda
kanıtlanmadan kalıcı tampon ürün kabulü yapılamaz.

## Arka plan

İncelenen expo-audio 57.0.4 Android kaynağında AudioStream.start mikrofon iznini
kontrol edip stream.start çağırır; AudioRecordingService AudioRecorder nesnelerini
yönetir. enableBackgroundRecording tek başına PCM akışını servise bağlamaz.
Bu PoC arka plana geçince durur. Gerçek arka plan için native servis entegrasyonu,
kalıcı bildirim/durdurma eylemi, izin reddi ve işletim sistemi sonlandırma testleri
ayrı değişiklikte gerekir. iOS ses oturumu ve kilit ekranı da cihazda denenmelidir.

## Kabul

Sağlayıcıdan bağımsız kod incelemesi, gerçek Android/iOS ve gerekli uçtan uca
kontroller tamamlanmadan #6/#7 kapatılmaz. Bu taslak üretim ayarı değiştirmez.
