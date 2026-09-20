# ADR-0014 — OTA uyumluluğu için fingerprint ve ayrı native profiller

Durum: kaynak önerisi, #11. Native paket/yayın kabulü bekleniyor.

## Problem

#11 başlangıçta `runtimeVersion.policy=appVersion` tanımlıyordu. Bu, native
modül değişince insanın her defasında sürüm yükseltmesini gerektirir. Repo artık
expo-print, PCM ve şifreli depolama gibi native bağımlılıklar içeriyor. Aynı
uygulama sürümünün korunması, eski telefona uyumsuz JS gönderilmesine yol açabilir.

## Seçenekler ve karar

- appVersion + zorunlu manuel native sürüm artışı: sade ama atlanabilir.
- nativeVersion: build numarasına bağlı, her build için update uyumluluğunu daraltır.
- **fingerprint**: native bağımlılık/yapılandırma uyumluluğunu araç hesaplar.

Yeni OTA destekli paketler için fingerprint seçildi. Mevcut normal profil ve
OTA kapalı APK davranışı korunur; bu paketlere uzaktan native özellik eklenmez.
`ota-*` profilleri açık EAS ortamı seçer. Development OTA kabul paketi de internal
release paketidir; dev-client veya iOS simulator kabul paketi diye kullanılmaz.

## Sonuçlar

Yeni build'in FINISHED durumu, app/project/profile/channel ve runtime/fingerprint
birlikte doğrulanır. JS yayını yalnız aynı fingerprint'e yapılabilir. Eski runtime
için ilerletme/geri dönüş aynı native build kimliğiyle mümkündür; yerel yeni
fingerprint'in eskiyle eşit olması kurtarma için şart değildir.

CI guard gerçek fiziksel kabulü ispatlamaz. Fingerprint veya EAS sorgu şeması
değişirse kontrollü kaynak güncellemesi gerekir; başarısız okumada yayın yapılmaz.
Saklama süresi, kullanıcı verisi veya FCM/APNs etkinliği bu kararla değişmez.

[Expo runtime versions](https://docs.expo.dev/eas-update/runtime-versions/)
