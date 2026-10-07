# #8: Doğrulanmış analizin sistem PDF ekranına aktarılması

Durum: Yerel uygulama/PoC; Android ve iOS cihaz kabulü bekliyor.

Expo SDK 57 ile uyumlu resmi expo-print kullanılır. `printAsync({html})` sistem
yazdırma arayüzünü açar; PDF kaydetme/paylaşma cihazın sistem seçeneklerinden yapılır.
Uygulama kendi kalıcı PDF dosyasını veya yeni bir belge önbelleğini oluşturmaz.
Sistem ve kullanıcının seçtiği hedefteki çıktı yaşam döngüsü uygulama kontrolü dışındadır.

Yalnız doğrulanmış AnalysisSnapshot alanları aktarılır. Metin HTML olarak çalıştırılmaz:
kaçış uygulanır, CSP dış kaynak ve script yüklemeyi engeller. Canlı sonuç durumu korunur.
Yeni native paket nedeniyle yeni APK/iOS derlemesi gerekir; mevcut APK'da yoktur.

PoC: live-test analiz panelindeki PDF / Yazdır düğmesi. Türkçe, uzun aksiyon tabloları,
iptal, PDF kaydetme ve iOS yazdırma/paylaşma davranışı cihazda doğrulanmalıdır.
