# Gerçek konuşma testi — izole PoC

Bu klasör mevcut `C:\platform-ai\platform-mobile` çalışma ağacından ayrı bir kopyadır. Üretim veya PR kabulü değildir.

## Uygulananlar

- Expo 57.0.20 uyumlu paket geçişi; resmi expo-audio 57.0.4 `useAudioStream` API'si. Yeni üçüncü taraf native mikrofon paketi yok.
- `app/live-test.tsx`: PKCE giriş, gerçek sunucu toplantı listesinden seçim, gösterilen metinle kayıt onayı, mikrofon izni, canlı geçici/final metin, 60 saniyelik ön plan testi.
- `liveTestApi.ts`: doğrulanmış test edge URL, gateway consent/session/finish uçları. Token yalnız bellekte. Teste kalan token ömrü kontrol edilerek başlanır.
- `foregroundStream.ts`: sunucu ready olmadan yakalama başlamaz. 16 kHz mono dışı ses reddedilir. Bağlantı hatası/geri basınçta test durur. EOF sonrasında final metinler alınır ve drained beklenir.
- PoC için OTA güncellemeleri kapalıdır. Mevcut APK'ya güncelleme gönderilmedi.

## Bilinen eksikler ve kabul engelleri

- 8 Eylül 2026: Halil Bey TEST mobil istemci kaydını oluşturdu (#3 yorum 5584373565). Kullanıcı Microsoft girişinden sonra toplantı listesi gelmeden 403 gördü (#3 yorum 5585210395). Yetki/kurum eşleşmesi kaynaklı kesin neden henüz doğrulanmadı.
- PKCE callback `workcube://oauthredirect` cihazda doğrulanmadı; sunucuda exact redirect kaydı ve uygulama yönlendirmesi birlikte test edilmeli.
- Bu bir ön plan PoC'sidir. Offline dayanıklılık, refresh/logout, arka plan kaydı, yeniden bağlanma, toplantı yaşam döngüsü bildirimi ve iOS kabulü tamamlanmış değildir. Canlı analiz paneli eklendi ancak sunucu/cihaz kabulü yapılmadı. İlgili issue'lar kapatılamaz.
- Ağda oturum oluşturma yanıtı kaybolursa uzlaştırma/outbox henüz yoktur. Test başarısı ilan edilmez; bu üretim kabul engelidir.
- Uygulama birim testleri gerçek mikrofon/donanım ve sunucu kabulünü kanıtlamaz.

## Cihazda kabul sırası

1. Mobil istemci PKCE S256, public client, exact callback ve gateway audience/tenant/user claim sözleşmesiyle hazır olmalı.
2. APK kurulumu, giriş dönüşü ve yetkili toplantı listesi doğrulanmalı.
3. Kayıt onayı/izin verilmeden ses yakalanmadığı doğrulanmalı.
4. Kullanıcı kısa Türkçe cümle söyler; bunun gerçek canlı metin olarak geldiği gözlenir.
5. Durdur sonrası son cümle gelir; uygulama kapanış sonucu gösterir.
6. İzin reddi, ekranın arka plana alınması, ağ kopması ve yeniden deneme test edilir.

Bu adımlar gerçekleştirilmeden kullanıcıya "konuşma testi hazır/çalışıyor" denmemeli.

## 8 Eylül yerel geliştirmeleri

- #7 tampon çekirdeği: taşıma katmanına gönderim artık silme sayılmaz; eşleşen oturum/parça teslim makbuzu gerekir. Yeniden bağlantıda bekleyen parçalar tekrar gönderilebilir. İçerik değişimi reddedilir, tekrar aynı parçanın TTL süresini uzatmaz. Bu çekirdek foregroundStream yoluna henüz bağlanmadı; WS send veya drained kalıcı teslim kanıtı değildir.
- SQLCipher açıcı ayrı ve kapalıdır: saklama süresi verilmezse veya SQLCipher yoksa ses tablosu oluşturmaz. Uygulamada kalıcı ses depolama açılmadı. Saklama politikası, anahtar/veritabanı yaşam döngüsü ve gerçek cihaz kabulü gereklidir.
- #8: masaüstündeki mevcut /analyze/live/stream/{meetingId} SSE yolu ve backend analiz şeması kullanılarak toplantı sırasında özet/karar/aksiyon paneli eklendi. Eski sürüm sonucu ve doğrulanmamış özet gösterilmez. Konuşmacı olay sözleşmesi ve dışa aktarma henüz tamamlanmadı.
- #6: görünür mikrofon göstergesi eklendi. Expo 57 Android AudioStream yolu AudioRecordingService'e kayıt olmuyor; servis AudioRecorder için uygulanmış. Bu nedenle yalnız yapılandırma bayrağıyla arka plan garantisi verilemez. Uygulama arka plana geçince kaydı durdurmaya devam eder.
- 81 birim testi, TypeScript ve değişen dosyaların lint kontrolü geçti. Bunlar donanım, sunucu veya issue kabulü değildir.
