# #11 — Kademeli güncelleme

Yerel CI hazırlığı; yayın veya cihaz kabulü değildir. Mevcut app.json OTA kapalıdır;
workflow bu halde dağıtımı reddeder. development/preview/production kanalları EAS
build profillerine bağlandı. EAS kanal/branch eşleştirmeleri uzakta doğrulanmadı.

İlk yayın %5, ayrı işlemler %25 ve %100. Önceki sürüme dönüş açıkça belirtilen
önceki group UUID'sini yeniden yayınlar. Operatör group'un doğru proje/kanal/runtime
ve test edilmiş önceki sürüm olduğunu doğrulamalıdır; script bu uzak üyeliği doğrulamaz.
GitHub mobile-development/mobile-preview/mobile-production environment ayarları,
gerekli reviewer ve EXPO_TOKEN repo sahibinin yayın kurulumunda tanımlanmalıdır.

OTA aktivasyonu için test edilmiş native sürümde updates.enabled=true ve projenin
https://u.expo.dev/3597d06c-21ec-4908-b453-e72f219d5758 adresi gerekir. Native paket
değişiklikleri OTA ile dağıtılmaz: appVersion artırılıp yeni native build alınmalıdır.
Bu dalda expo-print eklendiğinden eski APK'ya JS güncellemesi gönderilmemelidir.

Kaynaklar: https://docs.expo.dev/eas-update/rollouts/ ve https://docs.expo.dev/eas/cli/
