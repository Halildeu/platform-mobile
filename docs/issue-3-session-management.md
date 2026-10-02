# Issue #3 — mobil oturum yönetimi

Yerel uygulama değişikliği, 2026-09-09. Issue kapatılmadı, APK henüz oluşturulmadı.

## Issue kapsamı ve uygulama

- Expo AuthSession PKCE: mevcut platform-test / platform-mobile / workcube://oauthredirect korunur.
- Şifreli token saklama: Expo SecureStore, WHEN_UNLOCKED_THIS_DEVICE_ONLY; yalnız refresh token varsa kalıcı saklama. Access-only oturum bellekte kalır. Kimlik bilgileri tanılama kaydına yazılmaz.
- Refresh: erişim süresi 60 saniyenin altına indiğinde yenileme; ön planda 30 saniyelik kontrol ve uygulamaya dönüş kontrolü. Kayıt başlatmadan önce en az 120 saniyelik geçerlilik aranır. Eşzamanlı yenilemeler tek istekte birleşir, dönen refresh token eskisinin yerini alır.
- Session expire: invalid_grant veya eşleşen güncel bearer için HTTP 401, kayıtlı oturumu temizler. Geçici ağ hatası refresh bilgisini silmez; işlem süresi dolmuş bearer ile başlatılmaz. POST işlemleri otomatik tekrar edilmez.
- Logout: önce cihaz kaydı temizlenir; sonra ID token hint gövdede gönderilerek Keycloak RP-Initiated Logout POST yapılır. Microsoft hesabının tüm uygulamalardaki oturumu kapatıldığı iddia edilmez. ID token yoksa veya sunucu isteği başarısızsa yerel çıkış ile sunucu doğrulaması ayrılır.
- Yarış koruması: logout/hesap değişiminden sonra dönen refresh oturumu yeniden yazamaz; saklama işlemleri sıralıdır. Disk silme hatası kullanıcıya bildirilir.

Resmi logout referansı: https://www.keycloak.org/securing-apps/oidc-layers
Eski refresh_token logout formatı yerine ID token hint içeren RP-Initiated Logout kullanılır.

## Doğrulama

98 Jest testi geçti; yeni testler restore, refresh coalescing/rotation, late-refresh after logout,
geçici ağ hatası, invalid_grant, eski bearer rejection, SecureStore seçenekleri,
body-only logout, ekran restore ve logout sonrası toplantı listesinin kaldırılmasını kapsar.
TypeScript ve değişen dosyaların lint kontrolleri geçti.

## Gerçek cihaz kabulü bekliyor

Android/iOS SecureStore yazma/okuma, uygulamayı yeniden açma, gerçek refresh rotation,
sunucuda logout sonrası refresh reddi, expiry/revocation ve hesap değiştirme doğrulanmalı.
Microsoft tarayıcı oturumu ile uygulama oturumu aynı şey değildir.
Sunucu 1011 hatası bu değişikliğin konusu değildir. Yeni izin, rol veya sunucu ayarı eklenmedi.
Telefon kanıtı ve repo inceleme süreçleri tamamlanmadan #3 kapanmaz.
