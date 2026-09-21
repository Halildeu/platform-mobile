# Telefon sonrası metin ve sekme düzeltmeleri — 21 Eylül 2026

## Öncelikli açık kabul: toplantı sürerken karar ve aksiyon

Kararlar ve sorumlu/tarih içeren aksiyonlar **kayıt devam ederken**, konuşma
ilerledikçe kendi sekmelerinde görünmeli ve güncellenmeli. Durdur düğmesine
basılması veya nihai raporun hazırlanması ön koşul olamaz. Kaydedilmiş analiz
sekmelerini düzeltmek bu kabulü karşılamaz.

Fiziksel denemede 50 kesin metin olayı ve sıfır canlı analiz sonucu görüldü.
Kayıt kapanışı doğrulandı ve kalıcı sonuç sonradan geldi. Canlı zincirin kök
nedeni henüz doğrulanmadı: kesin metin alımı, analiz girdisi, taslak üretimi,
SSE teslimi ve mobil çizim zamanları aynı oturum için eşleştirilmeli. Nihai
sonlandırma bekleme penceresini değiştirmek canlı gereksinimin çözümü değildir.

## Kaynak değişikliği

- Kaydedilmiş metnin varsayılan görünümü, kopyalanması ve PDF girdisi aynı
  okunabilir sunumu kullanır. Tekil parça satır sonları birleştirilir;
  paragraflar ve konuşmacı sınırları korunur. Orijinal görünüm seçilebilir.
  Kaynak metin, hash ve konuşmacı offsetleri değişmez; sözcük, yıl veya saat
  düzeltmesi yapılmaz. Uzun satırlar Unicode ve mümkünse sözcük sınırında
  sanallaştırılır; export metnine ek ayırıcı konmaz.
- Başlık/ayarlar ve metin tek kaydırma alanında. Boş/yükleniyor/hata durumunda
  da başlık erişilebilir. Aktif mikrofon göstergesi ve Durdur kaydırma dışında
  kalır. Seçilen konuşmacının ad editörü ilgili satırda açılır.
- Yeniden açılmış toplantının kalıcı analizi kendi Özet/Kararlar/Aksiyonlar
  sekmelerinden okunur. Aktif veya henüz bitirilen kaydın canlı taslağına eski
  kalıcı sonuç yerleştirilmez. Toplantı/hesap değişimi ve geç yanıt sınırları
  korunur. Bölüm görünümünden export alırken tüm raporu içerdiği belirtilir.

## Yerel doğrulama

- Jest: 50 suite, 483 test başarılı. Son sözcük sınırı düzenlemesi sonrası
  ilgili iki suite/17 test tekrar başarılı. TypeScript ve ESLint başarılı.
- Bağımsız Codex kaynak incelemesi: AGREE. Mantıksal metin parçalama ve
  editör konumu hakkındaki ilk iki bulgu düzeltildi. İnceleme native kabul
  veya gerçek sunucu teslimi onayı değildir.
- Android ve iOS Expo JavaScript/Hermes export başarılı. Bu sonuç native
  derleme, APK kurulumu, Detox veya Maestro sonucu değildir.
- İzole sentetik web önizlemesinde 360×640 alan ve büyük yazı ile okunabilir
  metnin sonuna erişim, orijinal görünüm, boş/hatalı sonuç kontrolleri,
  uzun metindeki ikinci konuşmacının editörü ve aksiyon bölümü gözle doğrulandı.
  Yalnız önizleme kopyasındaki auth/API/native export sınırları stublandı;
  bu dosyalar uygulama kaynağına taşınmadı. Native PDF/klavye/safe-area kabulü
  bu tarayıcı kontrolünden çıkarılamaz.
- Kayıt açıkken enjekte edilen iki ardışık analiz olayıyla mobil karar ve
  aksiyon güncellenmesi test edildi. Bu test gerçek SSE/sunucu üretiminin
  telefona çalıştığını kanıtlamaz; yukarıdaki canlı kabul açıktır.

## Dağıtım durumu

Telefon eski `6ed9f484623ab8b8ca8e27990f05978e7337e334` APK'sını kullanıyor.
Bu düzeltmeler için yeni APK, uzak CI, merge, deployment veya issue kapanışı
yapılmadı. Son pakette metin/kopyalama/PDF, yeniden açma, A→B→A geçişi,
aktif kayıt ve gerçek canlı karar/aksiyon teslimi tekrar doğrulanmalı.
