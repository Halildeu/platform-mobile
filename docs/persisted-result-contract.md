# Kalıcı sonucu yeniden açma — kaynak doğrulaması

10 Eylül 2026, platform-backend main salt okunur kontrolü.

Mevcut mobil panel yalnız ephemeral SSE kullanıyor. LiveAnalysisStreamHub açıkça
no persistence / no replay davranışını tanımlar. Bu nedenle canlı panelde görünen
bir sonuç, uygulamayı yeniden açınca sunucudan okunmuş kalıcı sonuç değildir.

Gerçek okuma endpoint'i:
GET /api/v1/admin/meetings/{meetingId}/intelligence/result

MeetingIntelligenceController VIEWER modül kontrolü ve no-store yanıtı kullanır.
MeetingIntelligenceResultService tenant görünürlüğünü doğrular ve latest analysis
run'a ait karar/aksiyonları döndürür; okumayı audit kaydına yazar.
404 hem MEETING_NOT_FOUND hem ANALYSIS_RESULT_NOT_FOUND olabilir; istemci her
404 için kesin “analiz henüz hazır değil” iddiası üretmemeli.

DTO: analysisRunId, meetingId, sessionId, schema_version, summary,
summary_grounding_status, summary_citations, decisions, action_items, citations,
generatedAt, persisted, storageMode. Canlı DTO'daki version/is_partial ve
grounding_policy burada yoktur; canlı parseAnalysis doğrudan kullanılamaz.

İstemci kabul şartları:
- Canonical/persisted ve toplantı kimliğini doğrula; bilinmeyen yanıtı gösterme.
- Güncel kayıt sonucu bekleniyorsa sessionId eşleşmeden bu kaydın sonucu deme.
- Seçim/çıkış sırasında geciken yanıt önceki toplantı içeriğini geri getirmesin.
- Yerel kalıcı transcript cache oluşturma; yeniden açışta yetkili API'den oku.
- Kaynak alıntılarını ve canlı/kalıcı sonuç ayrımını açık göster.
- Otomatik analyze POST veya kontrolsüz yeniden analiz tetikleme.

Kaynaklar:
- meeting-service/src/main/java/com/example/meeting/controller/MeetingIntelligenceController.java
- meeting-service/src/main/java/com/example/meeting/dto/v1/admin/MeetingIntelligenceResultResponse.java
- meeting-service/src/main/java/com/example/meeting/service/MeetingIntelligenceResultService.java
- audio-gateway-service/src/main/java/com/example/audiogateway/service/LiveAnalysisStreamHub.java

Mobil GET/UI bağlantısı yerel kopyada eklendi. Seçili toplantıda “Kalıcı sonucu
aç / yenile” yetkili API okuması yapar; kaynak alıntıları ayrı açılır. İçerik diske
yazılmaz. Toplantı değişimi, kayıt başlangıcı veya çıkış paneli temizler; geciken
yanıt eski içeriği geri getiremez. Sonuç, toplantının latest kaydı olarak etiketlenir;
son mikrofon denemesinin sonucu olduğu iddia edilmez. Session-specific endpoint
olmadığı için iki oturumun ayrı geçmişini gezme henüz sağlanmaz.

Yanıt sınırı, canonical/persisted, toplantı kimliği, geç tarih, aksiyon ve kaynak
doğrulama kontrolleri eklendi. İlgili parser/UI/API testleri geçti. Bu değişiklik
derlenmiş APK'larda yoktur; gerçek normal kullanıcı kabulü ayrıca gereklidir.
