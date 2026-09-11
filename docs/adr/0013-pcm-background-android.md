# #6 — Expo PCM Android foreground service PoC

Durum: Yerel native PoC; derleme ve cihaz kabulü ayrı kaydedilir.

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
üzerinde native stop, 60 saniyelik native sonlandırma ve observer temizliği eklendi.
Mevcut UIBackgroundModes=audio kullanılır; iOS mikrofon göstergesi sistem tarafından
gösterilir, Android bildirim izni iOS'ta istenmez. Native capability olmayan eski
build arka plan seçeneğini göstermez. Swift derlemesi ve iOS cihaz kabulü ayrıca gerekir.

Kabul: Android 13+ izin reddi, kanal kapalı, ekran kilidi, native bildirimden durdurma,
uygulamaya dönüş, task swipe, bağlantı kopması ve yeniden kayıt; mikrofon sistem
göstergesi, bildirim ömrü ve sunucudaki parçalar birlikte doğrulanmalıdır. 60 saniyelik
test sınırı devam eder. Testler geçmeden #6 kapanmaz.
