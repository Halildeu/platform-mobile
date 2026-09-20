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

2026-09-15 kaynak düzeltmesi: kapatma hatasında depolama erişimi engellenir;
anahtar/dosya silinmeden önce veritabanı kapatma yeniden denenir. Eşzamanlı
temizleme çağrıları tek işlem paylaşır. Anahtar silme başarısızlığı sonraki
çağrıda yeniden denenebilir. Saklama süresi ve varsayılan kapalı durum değişmez;
bu düzeltme gerçek cihaz veya kalıcı tampon entegrasyon kabulü değildir.

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

## 2026-09-15 kayıt akışına tampon seçimi

`live-test` mikrofon/WebSocket başlamadan `createRecordingBuffer` çağırır.
`expo.extra.audioBufferRetentionMs` yok/null olduğunda mevcut 2 MiB/2000 parça
bellek tamponu kullanılır; native SQLite modülü yüklenmez ve anahtar oluşturulmaz.
Bu değişiklik app.json içine süre veya etkinleştirme ayarı eklemez.
Pozitif tam sayı yapılandırıldığında kullanıcı/tenant hash'i ve ses oturumu ile
ayrılmış mevcut SQLCipher açıcı kullanılır. Geçersiz süre veya şifreleme hatasında
kayıt başlamaz; şifresiz depolamaya geri dönüş yoktur.

Kapanışta sadece bekleyen parçası olmayan tampon silinir. Gönderilmiş fakat
onaylanmamış parçalar varken veritabanı kapatılır, içerik silinmez. Temizleme
başarısızlığı tanılamaya yazılır ve sonraki başlangıçtan önce yeniden denenir.
Bu bağlantı uygulama yeniden başlatıldıktan sonra otomatik ses replay'i değildir.
Kapalı veritabanlarının yeniden açılışta keşfi/TTL temizliği ve hesap değişimi
kabulü henüz yoktur; süre belirlenmesi tek başına etkinleştirme kabulü sayılmaz.
Bu kontroller tamamlanana kadar yapılandırma boş tutulmalıdır. Kayıt akışı
bellek tamponuyla devam eder; #7 kapanış veya gerçek cihaz kabulü iddiası yoktur.

## 2026-09-20 süre dolumu ve teslim hatası

Bağımsız TTL temizleyicisinin sildiği onaylanmamış parça, boş kuyruk üzerinden
başarılı EOF/drained sonucuna dönüşemez. Akış, oturum tamponunun toplam süre
dolumu/kapasite kaybını başlangıç, gönderim, ACK, drain ve kapanışta kontrol eder;
yeniden bağlanma bu kanıtı sıfırlamaz. Reconnect sırasında gözlem sürer ve
mikrofon olayı gelmese bile süresi dolmuş ses için kayıt durur. `drain()` içindeki
ikinci purge de gönderimden önce kontrol edilir. Kısmi silme hatasında daha önce
silinen satırların kayıp sayacı korunur.

Okunamayan/kapalı tampon sayacı `0` yerine bilinmiyor olarak raporlanır. Depolama,
socket kapatma veya hata callback'i başarısız olsa da akış timer'ları iptal edilir
ve bekleyen stop sonucu false olur; ham hata/konuşma/anahtar tanılamaya eklenmez.
Kalıcı tampon kapalıyken kullanılan bellek kuyruğu release sırasında temizlenir.
Bu temizleme, teslim onayı değildir. Saklama değeri eklenmez veya değiştirilmez.

Kalıcı kurtarma için hâlâ gerekli: sahip/oturum bazlı keşif kaydı, kapalı tampon
TTL temizliği, uygulama yeniden açılışında sıra ve ACK korunarak replay,
logout/hesap değişimi ve gateway/canonical finish ile güvenli sıralama. Özellikle
başarısız drain sonrası HTTP finish/reopen yolu incelenmeden eski kayıt kurtarıldı
denemez. Bu değişiklik bu kalan şartları veya cihaz kabulünü karşılamaz.
