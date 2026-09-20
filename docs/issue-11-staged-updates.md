# #11 — Kademeli güncelleme ve geri dönüş

Bu kaynak hazırlığıdır. EAS yayını, imzalı yeni paket, gerçek cihaz kabulü veya
mağaza gönderimi yapılmış sayılmaz. Normal `app.json` ve mevcut build profilleri
OTA kapalı kalır. Yeni `ota-development`, `ota-preview`, `ota-production`
profilleri fingerprint ile uyumlu, OTA açık **yeni native paket** üretmek içindir.
Gerekçe: [ADR-0014](adr/0014-ota-fingerprint-release.md).

## Yayın ön koşulları

1. Güncel kaynağın inceleme/testlerini ve ana dal entegrasyonunu tamamlayın.
2. İlgili EAS development/preview/production ortamında uygulamanın gerçek
   yapılandırmasını hazırlayın. Native build ve update aynı ortamı kullanmalı.
   Android FCM TEST ayarları yalnız onaylı TEST ortamında bulunmalı.
3. `ota-*` profilinden alınmış FINISHED native paketi imzalama/cihaz kabulünden
   geçirin. EAS build UUID, kaynak commit ve fingerprint kanıtını saklayın.
   Mevcut OTA kapalı APK'ya OTA ile bu özellik eklenemez.
4. EAS'te kanal ve aynı isimli branch tek eşleşmeli olmalı. Branch rollout ile
   update rollout aynı operasyonda karıştırılmaz; script kanal oluşturmaz/değiştirmez.
5. GitHub `mobile-development`, `mobile-preview`, `mobile-production`
   environment korumalarını, yetkili review ve EXPO_TOKEN erişimini yapılandırın.
   Credential içeriği artifact, issue, çıktı veya APK'ya konulmaz.

## İş akışı

`Mobile staged update` yalnız main üzerinde manuel çalışır. Girdiler:

- `channel`, `platform`: tek hedef; aynı kanaldaki Android/iOS işlemleri de
  aynı concurrency kilidini paylaşır.
- `build_id`: kabul edilmiş `ota-*` native build UUID. Başka proje/app/channel,
  simulator, tamamlanmamış paket veya fingerprint uyuşmazlığı reddedilir.
- `operation`, `group`: aşağıdaki işlemler. `group` **mevcut** gruptur.
- `previous_group`: yalnız `rollback-previous` için ayrıca belirtilir.
- `execute`: varsayılan false. Önce salt okunur plan/receipt alın; kabul ve
  kanal durumunu değerlendirdikten sonra yetkili yayın için true seçilir.

| İşlem | Ön koşul ve sonuç |
|---|---|
| publish-5 | Seçili runtime/platform için aktif rollout yok; yerel native fingerprint build ile aynı. İlk %5 yayın. |
| advance-25 | Aynı mevcut grup %5'te; %25'e ilerler. |
| advance-100 | Aynı mevcut grup %25'te; %100'e ilerler. |
| revert-current | %5/%25 aktif rollout'un **gerçek control update** grubuna döner. Control null ise embedded sürüme döner. |
| rollback-previous | Aktif rollout yok; açıkça seçilen hemen önceki uyumlu tamamlanmış grubu yeniden yayınlar. |
| rollback-embedded | Aktif rollout yok; eski grup gerektirmeden native paketin içindeki sürüme döner. |

Her yüzde yükseltmesinden önce ilgili kohortta hata/başlangıç/kayıt/sonuç ve
bildirim kabulü değerlendirilmelidir. Yüzde değişimi otomatik telefon kabulü değildir.
Grup işlemleri tüm grubu etkilediğinden çok platformlu eski gruplar reddedilir;
geçiş için ayrı operatör incelemesi gerekir. Yeni yayınlar platform başına yapılır.

## Doğrulama ve belirsiz sonuç

EAS CLI `24.7.0` sabittir. `build:view` çıktısından tam paket kimliği okunur.
Kanal/proje/branch ve son iki ilgili update, Expo'nun EAS CLI kaynaklarındaki
salt okunur GraphQL sorgularıyla okunur. `update:view --json` control ve yüzde
bilgilerini düşürdüğü için o gösterim çıktısından geri dönüş hedefi tahmin edilmez.
API alanları değişirse işlem durur; ham yanıttan best-effort yayın yapılmaz.
Bu hat OTA kod imzalama anahtarı kullanmaz. İmzalı veya imzası beklenen update
grupları ve OTA kod imzalama etkin yapılandırma, geri dönüş komutunun silme
aşamasına ulaşmadan reddedilir. Native APK/IPA imzalama bundan ayrı #10 işidir.

Mevcut ve control gruplarının **tüm üyeleri** doğrulanır; başka platforma yan etki
engellenir. Yayından hemen önce plan tekrar okunur; değiştiyse mutasyon yapılmaz.
Yayınlar yalnız sabit argümanlarla EAS CLI üzerinden yapılır; GraphQL mutasyonu yoktur.

`release-evidence/update.json` yalnız kimlik, commit, runtime, yüzde ve manifest
özeti/hash tutar. Manifest içeriği, URL imzası, token ve ortam değerleri tutulmaz.
CLI çağrısından **önce** durum `mutation-outcome-unknown` yazılır. CLI zaman aşımı,
hata veya son kontrol başarısızsa otomatik tekrar yoktur. GitHub aynı koşumun
ikinci denemesinin mutasyonunu reddeder. Receipt ve EAS'teki gerçek durum okunup
operatör karar vermeden yeni yayın çalıştırılmamalıdır. EAS rollout geri dönüş
komutu silme+yeniden yayınlama içerdiğinden kısmi hata özellikle bu kapsamdadır.

Başarılı son kontrol; kanal/branch, runtime/platform, yayın commit'i, yüzde,
control ve geri dönen manifest hash'ini doğrular. Eski native runtime'a geri
dönüş, main'in native fingerprint'i değişti diye engellenmez. EAS konsolundan veya
başka repodan eşzamanlı operatör değişimi kilitlenemez; işlem sırasında bunları
durdurun. Son kontrol bu yarışın her olası ara etkisini geri alamaz.

## Kabul kanıtı

- Yerel: `node --test scripts/update-plan.test.mjs scripts/update-remote.test.mjs scripts/release-config.test.mjs`
- CI: release/app config değişiklikleri artık mobile-unit-checks PR filtresinde.
- Henüz gereken: onaylı native paket, gerçek EAS metadata ile salt okunur
  preflight, development/preview %5→%25→%100 ve hem control hem embedded geri dönüş,
  iki platformda güncelleme/yeniden açma/kayıt testi. Bunlar olmadan #11 kapanmaz.
- #10 için EAS Submit/imzalama/mağaza teslimi hâlâ ayrı iş; ignore düzeltmesi
  veya OTA guard bunu tamamlamaz.

Kaynaklar: [Expo rollouts](https://docs.expo.dev/eas-update/rollouts/),
[runtime versions](https://docs.expo.dev/eas-update/runtime-versions/),
[EAS CLI](https://docs.expo.dev/eas/cli/),
[.easignore](https://docs.expo.dev/build-reference/easignore/).
Sorgu sözleşmesi: eas-cli@24.7.0 `graphql/queries/{UpdateQuery,BranchQuery,ChannelQuery}`
ve `graphql/types/Update`; rollback davranışı `commands/update/revert-update-rollout`.
