# Mobil çalışma durumu — 7 Ekim 2026

Bu kayıt, eski kabul belgelerinin tarihli durumunu silmeden güncel devam noktasını verir.
Yeni işe başlamadan PR başlıklarını, mevcut commit'leri ve aşağıdaki kanıtları yenileyin.
Kaynak/CI başarısı, sunucu dağıtımı veya fiziksel cihaz kabulü değildir.

## Tekrar yapılmayacak kaynak işleri

| Görev | Hazır olan / kanıt | Kalan |
|---|---|---|
| #1 otomatik kontroller | PR48, 6dc4c95: 730 test; Android/iOS Detox, Maestro ve iOS derlemesi başarılı | Yeni değişiklikte ilgili kontroller; bütün ürün kabulü olarak yorumlanmaz |
| #3 giriş | PKCE, şifreli token saklama, yenileme/çıkış ve yarış durumları kodda/testlerde mevcut | Gerçek SSO yenileme/çıkış/yetkisiz hesap kabulü |
| #4–6 kayıt/metin/arka plan | Kaynak PR48; kullanıcı Android arka plan ve ekran kapalı kayıt kabulünü daha önce yaptı | Aynı kabulü sebepsiz tekrarlatma; PR entegrasyonu ve gerekli platform kapsamını ayrı tut |
| #7 kesinti | Backend PR1201 637d7ebc, mobil 43394cb ve sonrası; GitOps PR3885 87a3b07 | TEST çalışma ortamı ön kontrolü, eşleşen sunucu dağıtımı, sonra üç cümle ve eksiksiz kapanış kabulü |
| #8 konuşmacı/aksiyon | Mobil 6dc4c95: eski kayıt etiket durumunu temizleme; AI PR355 349ebec: ardışık görev değişiklikleri; AI 548 test başarılı | AI bağımsız sağlayıcı incelemesi, TEST; konuşmacı backend PR1179/1178 bağımlılıkları ve cihaz kabulü |
| #9 bildirim | İzin, kayıt, token değişimi, hesap ayrımı kodu mevcut | TEST sağlayıcı kurulumu ve gerçek Android/iOS bildirim teslimi |
| #10 dağıtım | Paket üretme ve iç mağaza gönderim akışları mevcut | Kurumsal imzalama/mağaza erişimi ve gerçek paket kabulü |
| #11 güncelleme | %5/%25/%100 ve geri dönüş araçları mevcut | Gerçek EAS/uyumlu yeni paket ve güncelleme kabulü |

ERP aktarımı kullanıcı isteğiyle ertelendi. #8 tamamlandı diye kapatılmamalı.
Kaydedilmiş analizde son görev durumu hatası, yalnız canlı ekran doğru diye kapanmış sayılmaz.

## Güncel dış bağımlılık

7 Ekim salt okunur kontrolde TEST metadata işi [37453976829](https://github.com/Halildeu/platform-k8s-gitops/actions/runs/37453976829)
hâlâ queued, yürütülmüş adım yok. Backend PR1201 ve GitOps PR3885 açık.
Aynı kontrolü tekrar oluşturmayın; mevcut işi ve Halil Bey'e bırakılan PR yorumunu takip edin.
Pano okuma 7 Ekimde çalıştı; yazma izninin açıldığı bundan çıkarılamaz.

## Tanılama kullanılabilirliği

- APK workflow kaynak SHA'sını gerçek checkout'tan alır; uygulamada ve yeni olaylarda
  `Kaynak sürümü` gösterilir. Bu paket imzası/hash'i veya dağıtılmış sunucu sürümü değildir.
- Eski paketler bilinmiyor olarak kalır; eski olaylara yeni kaynak sürümü yazılmaz.
- Bu kaynak alanı OTA akışına eklenmez; fingerprint tabanlı yayın değiştirilmez.
- Kısa rapor <3500 karakter hedefiyle son kayıt hatası, oturum ve son olayları seçer.
  Gösterilmeyen olay sayısı açıklanır; tam geçmiş silinmez. Sıra öncelik sırasıdır.
- Tam teknik geçmiş ayrıca UTF-8 TXT paylaşılır. Ayrıntılı konuşma içeriği bu dosyaya
  eklenmez. Alıcı uygulamanın metin paylaşımını kesmesi yerine dosya seçeneği kullanılır;
  geçmişteki kesilmenin hangi uygulamada olduğu kesinleştirilmedi.
- TXT geçici dosyaları yalnız UUID adlarıyla ayrı önbellekte, en çok 3 dosya olarak
  tutulur. Paylaşım başlatılmadan iptal edilirse silinir. Native paylaşım açıldıysa
  alıcı okuyabilsin diye hemen silinmez; 10 dakika eşiği açılış/önde çalışma/sonraki
  paylaşımda temizlenir. Uygulama kapalıyken süre garantisi yoktur. Çıkışta temizlenir.
  Native paylaşıma teslim edilen dosya geri çağrılamaz; alıcı kopyaları uygulama dışındadır.
- Hesap/toplantı değişimi ve gecikmiş onaylar eski raporun paylaşılmasını veya silinmesini engeller.

## Devam sırası

Bu tanılama değişikliğinin kaynak incelemesi ve CI'sı → gerekiyorsa yeni APK →
sunucu engeli kalkınca eşleşen sürümlerle kesinti testi. Yeni APK tek başına #7'yi çözmüş sayılmaz.
Eski [10 Eylül kabul listesi](remaining-acceptance-2026-09-10.md) tarihsel kayıttır.
