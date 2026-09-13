# Issue #5 — canlı metin

2026-09-09, yerel değişiklik. APK ve cihaz kabulü henüz yok; issue açık.

- Gerçek konuşma ekranı mevcut TranscriptView/FlatList bileşenine bağlandı.
- Gateway partial.confirmed/tentative alanları kaybolmadan taşınır. Yalnız tentative
  varsa draft; confirmed varsa stabilizing (kesinleşiyor). Bunlar UI durumlarıdır,
  yeni sunucu olay türü icat edilmedi.
- Final ardından aynı içerik tekrar gelirse revised sayılmaz. Değişen final revised
  olur; geç partial kesinleşmiş metni geri alamaz.
- Satırın içeriği/boyutu büyüdüğünde de otomatik kaydırma yapılır. Yukarı kaydıran
  kullanıcı alta zorlanmaz; Canlı metne dön düğmesi takibi yeniden açar.
- Transcript FlatList, aynı yönlü ScrollView içine yerleştirilmedi. Türkçe/İngilizce
  etiketler i18next kaynaklarına eklendi. Koyu temada final metin açık renktir.

102 test geçti. Yeni geçiş, tekrar, manuel kaydırma ve takibe dönüş testleri eklendi.
Gerçek gateway ses/metin kabulü, cihaz performansı ve Android/iOS ekran kanıtı bekliyor.
