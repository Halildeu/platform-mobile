# #6 — Expo PCM Android foreground service PoC

Durum: Tarihsel PoC; 20 Eylül 2026 düzeltmesi aşağıdadır. Derleme ve cihaz kabulü ayrı kaydedilir.

## Güncel uygulama

Eski `withPcmBackground.cjs` aktif uygulama yapılandırmasında kullanılmıyordu;
60 saniyelik iOS durdurması ve buna bağlı eski plugin testleri kaldırıldı.
Android arka plan hizmeti `modules/workcube-pcm-background` üzerinden sürer;
bu değişiklik Android native uygulamasını değiştirmez. iOS PCM yaşam döngüsü
[ADR0014](0014-ios-pcm-lifecycle.md) ile ayrı, sürümü ve kaynak özeti denetlenen
entegrasyona taşındı. Otomatik kayıt süre sınırı yoktur.

Aşağıdaki metin eski PoC kararını kaydeder; mevcut cihaz desteğinin kanıtı değildir.

expo-audio 57.0.4 AudioRecordingService yalnız AudioRecorder tutuyor; AudioStream
bu servise kayıt olmuyor. Mevcut stream PCM16 sözleşmesini korumak için sürümü
kontrollü Expo config plugin ile ayrı PcmCaptureService eklendi. Alternatif,
başka mikrofon kütüphanesine geçmekti; issue Expo istediği için seçilmedi.

Servis varsayılan kapalıdır. Native özelliği içeren Android build'de kullanıcı
arka plan seçeneğini açar; just-in-time mikrofon ve bildirim izinleri alınır.
Servis mikrofon tipinde ve dış uygulamalara kapalıdır. Bildirimde durdurma doğrudan
native AudioStream.stop çağırır; JS bildirimini bekleyerek mikrofonu açık tutmaz.
Servis hatası, task kaldırılması ve servis kapanışı mikrofonu kapatır. Wake lock
yalnız aktif servis süresindedir. Başka ses formatı, disk kaydı veya servis adresi eklenmez.

Plugin kaynak eşleşmesi veya Expo sürümü değişirse build'i durdurur; upstream değişime
körü körüne uygulanmaz. AndroidManifest ve expo-audio native kaynakları prebuild'de
üretilir. iOS AudioStream için aynı capability yöntemi, AVAudioSession interruption/reset
üzerinde native stop, o PoC'ye özel süreli sonlandırma ve observer temizliği tasarlanmıştı.
Mevcut UIBackgroundModes=audio kullanılır; iOS mikrofon göstergesi sistem tarafından
gösterilir, Android bildirim izni iOS'ta istenmez. Native capability olmayan eski
build arka plan seçeneğini göstermez. Swift derlemesi ve iOS cihaz kabulü ayrıca gerekir.

Kabul: Android 13+ izin reddi, kanal kapalı, ekran kilidi, native bildirimden durdurma,
uygulamaya dönüş, task swipe, bağlantı kopması ve yeniden kayıt; mikrofon sistem
göstergesi, bildirim ömrü ve sunucudaki parçalar birlikte doğrulanmalıdır.
Eski süreli PoC mevcut davranışı tanımlamaz. Testler geçmeden #6 kapanmaz.
