# Native doğrulama derlemeleri

Proje: @serban1245/workcube-meeting, 3597d06c-21ec-4908-b453-e72f219d5758.
EAS hesabı ve proje eşleşmesi salt okunur doğrulandı. Mağaza/OTA yayını yapılmadı.

| Platform | Build | Kapsam |
| --- | --- | --- |
| Android preview | a9ff2214-2260-40b8-a6da-3fcab2952712 | 0.2.0, yeni toplantı, PDF, PCM foreground service, SQLCipher native desteği. Bu yükleme sonrasındaki ForegroundStream otomatik yeniden bağlantı değişikliğini içermez. Native derleme kontrolü içindir. |
| iOS simulator | 6b4ac1ac-1c0b-4d5f-a32c-b62302895b2f | 0.2.0, Swift interruption/reset/deadline desteği ve son yeniden bağlantı kodu. Simülatör artifact'ı gerçek iPhone'a kurulamaz. |

Başlatıldığında sonuçlar bekleniyordu. Başarı cihazda mikrofon/ekran kilidi veya
gerçek sunucu kabulü anlamına gelmez. Yerel Windows Gradle Kotlin derleyicisine
ulaşmadan Java NIO loopback/UnixDomainSockets connect hatası verdi; IPv4 denemesi
aynı sonucu verdi. Sistem güvenlik ayarları değiştirilmedi.

Son yerel doğrulama: 135 Jest testi, 3 dağıtım planı testi, 3 native plugin
dönüşüm testi geçti. Swift/Kotlin derlemesini JS testleri kanıtlamaz.

# Dış sözleşme eksikleri

## 10 Eylül sonuç doğrulaması

EAS build:view ile her iki build FINISHED, error=null olarak yeniden okundu.
Android Kotlin/native ve iOS simülatör Swift/native derlemeleri tamamlandı.
Bu sonuçlar yukarıdaki farklı kaynak kapsamları için geçerlidir; telefon kurulumu,
mikrofon/ekran kilidi, kayıt yetkisi veya kalıcı sonuç kabulü değildir.

- Android: https://expo.dev/accounts/serban1245/projects/workcube-meeting/builds/a9ff2214-2260-40b8-a6da-3fcab2952712
- iOS simülatör: https://expo.dev/accounts/serban1245/projects/workcube-meeting/builds/6b4ac1ac-1c0b-4d5f-a32c-b62302895b2f

Son telefon bulgusu önceki 1011'den farklı aşamadadır: kayıt onayı HTTP 403,
correlation c8cb0400-5fc3-4153-85f1-24fd69a2129b. Güncel #3 yorumlarında bu
isteğin sunucu loguyla eşleştirildiğine dair kanıt bulunmadı. Toplantı listesi
yetkisi düzeltmesi kayıt yetkisini kanıtlamaz. Yeni maildeki backend hazırlığı
normal kullanıcının mobil kayıt/kalıcı sonuç kabulünü de kanıtlamaz.

#9: İncelenen WebPushAdapter payload'ı yalnız title/body üretiyor. Native FCM/APNs
cihaz kayıt endpoint'i ve toplantı/event/deep-link alanlarını içeren payload bu
sözleşmede yok. Web abonelik anahtarları native cihaz tokenı yerine kullanılmadı.
Mobil push'un hazır olduğu iddia edilmez.

#7: Saklama süresi owner-supplied olmalı; unset durumda disk kayıt yolu açılmaz.
Yeniden bağlantı gerçek akışta bellekte tamponla bağlıdır. Uygulama öldürülürse
bellekteki parçalar kurtarılamaz; kalıcı teslim garantisi yoktur.
