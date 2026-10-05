# Mobil kalan kabul koşulları — 2026-09-10

Bu çalışma kopyasındaki değişiklikler son dağıtılan tanılama APK'sında yoktur.
GitHub issue kapanışı, uzaktan CI başarısı veya cihaz kabulü beyan edilmez.

| Issue | Yerel durum ve kalan iş |
| --- | --- |
| #1 | Ana ekran test kimlikleri ve Android release Detox referansı düzeltildi. Maestro uygulama kimliği/bekleme adımları düzeltildi, transkript tekrar oynatma akışı eklendi. Birim test/coverage CI dosyası hazır; uzak CI ve Android/iOS E2E çalıştırılmadı. |
| #3 | Oturum saklama, yenileme, çıkış ve yarış durumları testli. Gerçek cihazda yenileme/çıkış ve yetkisiz kullanıcı kabulü eksik. |
| #4 | PCM ve gateway istemcisi mevcut; gerçek sunucu ready aşamasındaki 1011 engeli çözülmeden uçtan uca kabul yok. |
| #5 | Canlı ekran durum geçişleri ve takip kontrolü bağlı. Cihazda uzun toplantı performansı ve gerçek revizyon akışı eksik. |
| #6 | Android PCM foreground service, görünür bildirim/native stop ve iOS interruption/reset/deadline PoC kodu eklendi. Yalnız yeni native capability bulunan build'de kullanıcı seçeneği açılır. 60 saniyelik test sınırı sürer. Native derleme ve gerçek ekran kilidi/cihaz kabulü bekleniyor. |
| #7 | Preview/QA TEST paketinde 15 dakikalık şifreli tampon gerçek akışa bağlandı; gönderim, süre dolumu ve çıkış temizliği var. Üretim kapalıdır. Android cihazda ağ kesme/yeniden bağlanma, SQLCipher disk doğrulaması ve sunucunun kalıcı işleme makbuzu hâlâ gereklidir; gateway ACK kalıcı transkript kanıtı değildir. |
| #8 | Doğrulanmış analiz, aksiyonlar, Markdown paylaşımı ve sistem PDF/yazdırma ekranı bağlı. PDF cihaz kabulü, konuşmacı düzenleme sözleşmesi ve ERP aktarımı eksik. |
| #9 | İncelenen notification-orchestrator PushSubscriptionController tarayıcı RFC8030 aboneliği ister: endpointUrl, p256dhKey, authSecret. Bu sözleşme native FCM/APNs token kaydı değildir. Native kayıt/gönderim sözleşmesi ve cihaz bildirim testi gerekli. |
| #10 | Android dahili APK derlenmişti. iOS imzalama ve TestFlight/Play dağıtım kabulü eksik. |
| #11 | Kanallar, %5/%25/%100 ve önceki group'a dönüş için manuel CI hazır. OTA kapalıyken çalışmayı reddeder. Uzak ortam/kanal kurulumu, OTA uyumlu native build ve dağıtım/geri alma cihaz kabulü eksik. |

## #9 kaynak

2026-09-10 tarihinde platform-backend main üzerinden salt okunur incelendi:
notification-orchestrator/src/main/java/com/serban/notify/api/PushSubscriptionController.java
ve api/dto/PushSubscribeRequest.java. Diğer bir serviste native endpoint bulunmadığı iddia edilmez.

## Sunucu ses engeli

Ek yerel geliştirme: yeni toplantı oluşturma, seçme ve liste yenileme gerçek
MeetingCreateRequest sözleşmesine bağlandı. Kimlik/kurum telefondan gönderilmez.
Oluşturma otomatik tekrar edilmez; belirsiz sonuçta liste yenileme uyarısı gösterilir.
Yeni native PDF bağımlılığı nedeniyle uygulama sürümü 0.2.0 oldu; henüz dağıtılmadı.

Telefon kaydı sunucu hazır olma aşamasında 1011 gösteriyor. Daha sonraki salt okunur
preflight direct-STT sağlık isteğinde zaman aşımı gösterdi. İki kaydın aynı kök
nedene ait olduğu henüz doğrulanmadı; sessionId ile sunucu hata kaydı eşleştirilmelidir.
