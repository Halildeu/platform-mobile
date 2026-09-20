# ADR 0020 — Kaydedilmiş konuşmacı bilgisinin korunması

Durum: kaynak önerisi; #8'in kalıcı isim düzenleme özelliğinin ön koşulu.

## Sorun

Canlı metinde mevcut olan anonim konuşmacı dönüşleri, backend'in immutable
finalization projection'ına alınmıyordu. Mobil kalıcı metin okuması da yalnız
string döndürüyordu. Toplantıyı yeniden açınca konuşmacı bağlantısı kayboluyordu.
Ekrana bir isim alanı eklemek, bu eksik kalıcı kimlik bağını çözmez.

## Karar

- Yeni finalization projection'ı metin, zaman ve opsiyonel `speakerAttribution`
  alanını birlikte hash'e bağlar. Scope tenant/meeting/source-session/transport
  epoch'tan türetilir; `S1` farklı scope'larda aynı kişi değildir. `UU` bilinmezdir.
- Dönüş aralıkları UTF-16'dır. Değiştirilen/redakte edilen metin önceki aralıkları
  devralmaz. Eski projection ve kalıcı projection'ı bulunmayan eski yeniden
  oluşturma yolu güncel metinden konuşmacı bilgisi ödünç alamaz.
- İç canonical read yalnız `includeSpeakerAttribution=true` isteğinde alanı
  döndürür. Mevcut analiz çalışanının strict üç alanlı segment sözleşmesi değişmez.
  Meeting-service bunu mevcut yetkili canonical okuma yoluyla ister. Yetki,
  occurrence, silinme, retention ve audit kontrolleri aynıdır.
- Mobil segmentlerin tam metni birebir oluşturduğunu kontrol eder. Hatalı/çok
  büyük opsiyonel projection için tam metni gösterir. Dönüş bütçesi doğrulamadan
  önce uygulanır; etiketler liste kaydırma sırasına göre değil kanonik sırada
  numaralanır. Numaralar yalnız bu kayda aittir, kimlik tespiti değildir.
- Seçilebilir metin, tam kopyalama ve PDF içeriği karakter karakter korunur.
  Gösterim etiketleri özgün konuşma metnine eklenmez. Kişi adını veya aksiyon
  sorumlusunu konuşmacı numarasından tahmin etmeyiz.

## Entegrasyon

Eşleşen backend dalı: `codex/mobile-saved-speakers-20260920` (platform-backend).
Yeni yazma ayarı `TRANSCRIPT_FINALIZATION_PERSIST_SPEAKER_ATTRIBUTION` varsayılan
false. Önce bütün backend snapshot okuyucuları yeni alanı anlayan sürüme alınır;
sonra TEST'te ayar açılır. Bu çalışma runtime ayarını değiştirmez. Ayarı kapatmak
yeni alanın yazılmasını durdurur, mevcut projection'ların okunmasını engellemez.
Yeni formatta veri yazıldıktan sonra onu okuyamayan eski backend'e dönülmez;
hash veya metin değiştirilerek geriye uyum sağlanmaz.

## Kalan zorunlu kapsam

#8 henüz bitmedi. Konuşmacı adını sunucuda, ilgili tenant/meeting/occurrence/scope
kimliğine bağlı olarak düzenleme; eşzamanlı düzenleme çatışması, yetki ve audit;
silinme/retention ile isim temizliği; Workcube ERP sözleşmesi ve aktarımı; gerçek
Android/iOS kabulü ayrı olarak tamamlanmalıdır. Bu değişiklik isim düzenleme
başarısı veya ERP aktarımı iddiası değildir.
