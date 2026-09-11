# Issue #7 — teslim ve yeniden gönderim

Yerel uygulama, güncelleme 2026-09-10. Issue kapanmadı. Bellek tamponu ve teslim onayı
foregroundStream/gerçek test ekranının koduna bağlandı; telefon APK'sında henüz yok.

Güncel gateway LiveSttWebSocketProxyHandler kaynak kodu audio_ack/chunk_seq üretir.
Bu gateway admission kanıtıdır; STT işlemi veya kalıcı transkript kanıtı değildir.

ChunkDelivery yeni bağlantının ready mesajından sonra bekleyen parçaları sıralı gönderir.
Onay gelene kadar parça kuyrukta kalır. Callback bağlantı nesline bağlanır; eski bağlantı
ve gönderilmemiş sıra için onay yok sayılır. Kopmada 500ms'den başlayarak 10s sınırına
kadar artan bekleme ve varsayılan 5 deneme vardır. Stop planlı denemeyi iptal eder.

Kuyruk parça sayısı ve PCM byte sayısıyla sınırlıdır. Kapasite dolunca eskiler çıkarılır;
TTL sınırında purge yapılır. Böyle oluşan sıra boşluğu sessizce gönderilmez: onGap ile
durulur ve eksik kayıt olarak raporlanmalıdır. KVKK silme işlemi teslim garantisine üstün gelir.
SQLCipher açıcı kapandıktan veya purge hatasından sonra veri kabul etmez.

110 test geçti. Yeni testler eski socket ack, tekrar gönderim, retry sınırı/iptali,
byte limitiyle kayıp, TTL sınırında yeniden bağlanma davranışlarını kapsar.
Gerçek akış ayrıca teslim onayından önce EOF göndermeme, erken drained reddi,
yavaş bağlantının düzelmesiyle kuyruğu boşaltma ve sahte/yanlış ack ile beklemenin
uzatılamaması testlerini içerir. Teslim 10 saniye ilerlemezse test açık hata ile durur.
Kuyruk 2 MiB / 2000 parça ile sınırlıdır; disk ses kaydı yapılmaz.

## Kalan kabul şartları

- Şifreli kalıcı kayıt için yetkili retention politikası henüz sağlanmadı. Bu nedenle
  saklama süresi uydurulmadı. SQLCipher native build eklentisi açıldı; disk ses tamponu
  gerçek kayıtta henüz açılmaz. destroy() kapatma ve scoped anahtar/dosya silme sağlar.
- Gerçek ForegroundStream yolunda ağ kopması için 500/1000/2000ms beklemeli üç
  yeniden bağlantı denemesi bağlandı. Aynı sessionId/chunkSeq korunur, ready sonrası
  bekleyen parçalar yeniden gönderilir. Eski socket callback'leri geçersizleşir.
  1008/1003/1011 gibi açık sunucu hataları otomatik tekrar edilmez. Mikrofon ikinci kez
  başlatılmaz; kullanıcı stop'u bekleyen bağlantıyı iptal eder. Factory ve ready bekleme
  süreleri sınırlıdır. Telefon/sunucu kabulü henüz yoktur.
  Bağlantı yeniden açıldığında upstream at-most-once
  semantiği ve gateway restart/dedup sınırıyla birlikte doğrulanmalı.
- SQLCipher gerçek cihaz, uygulama yeniden açılışı, logout/hesap değişimi, retention
  auto-purge ve Android/iOS ağ kesintisi kabulü bekliyor.
- ADR 0030 ve docs/adr/0001-mobile-stream-delivery-draft.md sınırları geçerlidir.
