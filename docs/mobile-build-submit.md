# İmzalı paket ve iç test dağıtımı — #10

İki ayrı manuel GitHub Actions akışı vardır: `Mobile EAS package build` paket
üretir/doğrular; `Mobile internal submission` yalnız seçilen paketi Google Play
internal kanalına veya App Store Connect'e yükler. `execute=false` varsayılandır.
Bu kaynak hazırlığı gerçek imzalı paket, TestFlight erişimi veya telefon kabulü
kanıtı değildir. İş #10 gerçek dağıtım kabulüne kadar açık kalır.

## Kurumun bir defa hazırlaması gerekenler

- Expo projesi `3597d06c-21ec-4908-b453-e72f219d5758`, uygulama
  `com.workcube.meeting`; yetkili EAS hesabı ve yeterli mevcut build kapasitesi.
  Akış plan satın almaz, proje oluşturmaz veya hesap değiştirmez.
- GitHub `mobile-development`, `mobile-preview`, `mobile-production`
  environment'ları, kurumun release onay/erişim kuralları ve `EXPO_TOKEN`.
- Aynı adlı EAS environment'larında uygulamanın hedef sunucu ayarları.
  TEST Firebase/FCM kaydı ve anahtarları ayrı #9 kapsamındadır.
- Android: EAS'ta bu uygulamaya bağlı upload keystore. İlk kurulumda EAS'ın
  otomatik üretim seçeneği yetkili operatörce kullanılabilir; CI'da
  `--freeze-credentials` mevcut imzalama kaydının değişmesini/üretilmesini engeller.
  Play Console uygulaması ve EAS Submit için yalnız gerekli yetkileri olan
  Google servis hesabı, EAS credentials yönetiminde önceden bağlı olmalıdır.
  FCM anahtarı Play dağıtım anahtarı değildir.
- iOS: Apple Developer/App Store Connect uygulaması, EAS dağıtım sertifikası ve
  provisioning profile; ayrıca EAS Submit için App Store Connect API anahtarı.
  Yükleme API anahtarı native imzalama sertifikası veya APNs anahtarı değildir.
  GitHub `mobile-production` variable `MOBILE_ASC_APP_ID` gerçek sayısal ASC app
  ID olmalıdır. Mevcut TestFlight test grubu ve tester erişimi kurumca hazırlanır.
  EAS bu app ID alanında ortam değişkeni çözümlemediği için akış, doğrulanan
  sayısal değeri yalnız submit komutunun ömrü boyunca geçici eas.json'a koyar;
  komut hata verse de orijinal dosya byte'ları geri yüklenir. Arada beklenmeyen
  değişiklik varsa üzerine yazılmaz. Aynı üretilmiş profil, sabit EAS'ın gerçek
  çözümleyicisiyle hem ön kontrolde hem PR testinde doğrulanır.

İmzalama/sunucu anahtarları Git'e, loga veya APK içine yazılmaz. Submit profili
EAS'ta önceden tanımlanmış credentials kaydını kullanır. Eksik bilgiler için
örnek kimlikler üretilmez. `EXPO_APPLE_APP_SPECIFIC_PASSWORD` kabul edilmez;
Apple yüklemesinde API anahtarı yolu kullanılır.

## Paket üretimi

1. İncelenmiş kod main'e normal süreçle entegre edildikten sonra `Mobile EAS
   package build` açılır. Bu hazırlık PR'ı main'i değiştirmemiştir.
2. Platform ve kanal seçilir. Normal `development` iOS simulator/dev-client,
   `preview` dahili cihaz paketi, `production` mağaza paketidir. `ota=true`
   ilgili `ota-*` profilini kullanır; development OTA profili de fiziksel
   cihaz için preview tabanlıdır. OTA kapalı/açık paketler karıştırılmaz.
3. Önce `execute=false` ile gerçek EAS config kontrolü; sonra yetkili operatör
   `execute=true` ile tek build başlatır. Source SHA workflow'nun main checkout'udur.
4. Dönen UUID hemen kalıcı receipt'e yazılır. Yalnız o UUID sorgulanır. FINISHED
   sonucu proje/uygulama/commit/platform/profil/kanal/simulator yönünden doğrulanır;
   OTA paketinde runtime ve fingerprint de eşleşmelidir.
5. Provider archive'ı sınırlı HTTPS indirmeyle alınır; byte sayısı ve SHA256
   `release-evidence/package.json` içine yazılır. APK/AAB/IPA veya simulator
   archive'ı ile receipt workflow artifact'inde 14 gün saklanır.

Dosya özeti, native imzanın kriptografik doğrulaması değildir. İlk gerçek
paketin sertifika/provisioning, kurulum ve uygulama kabulü ayrıca yapılmalıdır.
Android AAB doğrudan telefona kurulacak APK olarak sunulmaz.

## İç teste gönderme

`Mobile internal submission` girdileri: platform, OTA seçimi, kabul edilen
FINISHED **production/ota-production STORE** build UUID, o build'in tam source
SHA'sı ve indirilen dosyanın SHA256'sı. iOS simulator/dahili ad-hoc paketi veya
preview Android APK mağaza paketinin yerine geçirilmez.

`execute=false` gerçek build metadata'sını ve archive byte'larını kontrol eder.
`execute=true` aynı kontrolleri yapıp tekrar remote durumu okur; bu build için
önceden submission varsa yeni gönderim yapmaz. Kimliği kullanıcıdan açıkça alınan
tek build, `submit --id ... --no-wait --no-auto-testflight-setup` ile gönderilir.
`--latest`, `--path`, `--url`, otomatik submit ve otomatik tekrar yoktur.

Android hedefi sabit `internal`, release durumu `completed`; production Play
kanalına geçiş yoktur. iOS hedefi kurum variable'ından dondurulan ASC app ID'dir.
Yeni TestFlight grubu yaratılmaz. EAS24.7.0 submit JSON çıkışı sağlamadığından,
tek `Submission details` URL'sindeki UUID alınır ve herhangi bir sonraki ağ
isteğinden önce receipt'e yazılır. Eksik/çoklu kimlikten tahmin yapılmaz.

Sonuç, exact submission UUID üzerinden proje/platform/**submittedBuild.id** ve
store hedefiyle eşleştirilir. `FINISHED` EAS yükleme işleminin tamamlandığını
gösterir; Apple/Google işlemesi, mağaza incelemesi, tester erişimi ve cihaz testi
ayrı adımlardır. Bu nedenle bir upload başarısından #10 kapanışı çıkarılmaz.

## Kesinti ve devam

- Workflow otomatik tekrarında yeni build/submission oluşturulmaz.
- UUID biliniyorsa build akışında `existing_build_id` + orijinal `source_commit`,
  submit akışında önceki girdiler + `existing_submission_id` verilir. Her iki
  devam yolu, execute değeri ne olursa olsun yalnız mevcut işi okur.
- Receipt `creation-outcome-unknown` ise timeout sunucuya ulaşıldığını dışlamaz.
  Yeni oluşturma başlatılmaz. Operatör EAS ekranından mevcut işi/kimliği doğrular;
  UUID bulunursa yukarıdaki salt okunur devam kullanılır.
- Başlatılan UUID biliniyorsa network/45 dakikalık izleme sınırı nedeniyle
  oluşan hata işi iptal etmez veya yeniden başlatmaz. Aynı kimlik korunur.
- Ham CLI çıktısı, imzalı indirme URL'si ve provider hata gövdeleri artifact'e
  yazılmaz. Bilinen kimlik ve son doğrulanan aşama `package.json` içindedir.

## Doğrulama kapsamı

Yerel regresyonlar yanlış SHA/platform/uygulama, simulator/STORE ayrımı,
değişen hedef/byte, önceki submission, disk hatası, belirsiz komut sonucu,
kimlik kaydından önce ağ çağrısı yapılmaması, salt okunur devam ve sınırlı
indirmeyi kapsar. Pinned CLI ile platform/profil sözleşmesi ayrıca okunur.
Gerçek EAS/Apple/Play çağrıları ve imzalı cihaz kabulü bu kaynak testinin yerine
geçmez; kurum hazırlıklarıyla ayrıca çalıştırılır.

Kaynaklar: [EAS CI hazırlığı](https://docs.expo.dev/build/building-on-ci/),
[mağazaya yükleme ve tester ayrımı](https://docs.expo.dev/deploy/submit-to-app-stores/).
Komut/GraphQL alanları sabit eas-cli 24.7.0 `commands/build`, `commands/submit`,
`graphql/queries/BuildQuery`, `SubmissionQuery` ve `graphql/types/Submission`
kaynağıyla eşleştirilmiştir.
