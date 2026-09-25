# Telefon uzun deneme kabulü — 25 Eylül 2026

Kaynak: kullanıcının 17:51–17:53 canlı ekranları ve eksiksiz geçici teknik raporu.
Dağıtılan aday 90f2cac; cihazdaki binary kimliği bağımsız okunmadı.

- Toplantı: c5313a69-9b46-4b74-bb87-be471fbf2fa4
- Deneme: c949f6d5-5a05-4198-8712-54d7c6c1e4df
- Ses oturumu: SES-9db67770-9f6b-4f37-9d9f-1f8f4e10f102
- Mikrofon: 14:50:30.497Z; kullanıcı durdurma onayı: 14:54:32.151Z.
- Yaklaşık 4 dakika 1.7 saniyelik kayıt; uzun toplantı dayanıklılığının tamamı değildir.

## Canlı teslim ve kapanış

| UTC analiz gelişi | Sürüm | Karar | Aksiyon | Mikrofon açık |
| --- | --- | --- | --- | --- |
| 14:50:53.912 | 1 | 0 | 0 | Evet |
| 14:51:05.952 | 6 | 1 | 1 | Evet |
| 14:51:40.081 | 11 | 1 | 6 | Evet |
| 14:52:00.765 | 17 | 2 | 2 | Evet |
| 14:52:41.817 | 18 | 2 | 2 | Evet |
| 14:53:23.500 | 23 | 3 | 7 | Evet |
| 14:54:12.281 | 26 | 5 | 8 | Evet |

İlk analiz mikrofon başlangıcından 23.415 saniye, ilk aksiyon 35.455 saniye sonra.
Bunlar ilgili cümle bitişinden analiz gecikmesi veya model işlem süresi değildir.
Yedi sonuç tek SSE bağlantısında geldi; bozuk JSON/sözleşme reddi/taşma sıfır.
Sürüm numarasının atlaması tek başına istemci kaybı kanıtı değildir.

Kapanışta 2414/2414 parça gateway tarafından onaylanmış; bekleyen/süresi dolan/
kapasiteden silinen sıfır. Drained 14:54:32.326Z, HTTP FINISHED 14:54:32.625Z.
Bu raporda sesin kapanışı ve HTTP terminal onayı doğrulandı. Eski toplantıların
belirsiz kapanışlarını otomatik çözmüş sayılmaz.

## İçerik kabulü açık

- İlk sekiz görevden Sürüm 11'de altısı görülüyor. Kaynak ekranda ilk isim
  cümlesi noktayla bölünmüş. Sürüm 17'de aksiyon sayısı ikiye düşüyor; bu arada
  son metin olayı 14:51:25.838Z olarak sabit kalmış. Kaynağın o anda değişmemesi
  sunucunun bütün isteklerinin aynı girdiyi kullandığı anlamına gelmez; kuyruktaki
  sürümlerin kapsadığı metin/ret nedenleri raporda yok.
- Sürüm 23'te tarih sonrasındaki nokta bir görevi iki aksiyona bölüyor. Biri
  yalnız isim/görev nesnesi ve 28 Eylül; diğeri 2026/saat 10/tamamlayacak, sorumlu
  belirtilmemiş. Tamamlanmamış parça görev kabul edilmiş.
- Referans konuşmanın toplantı tarihi yerine kaynakta "28 Eylül Ekim" yazıyor;
  karar/özet bunu aktarıyor. Soyadı tanımada da kaynak ile referans farklı.
- Ürün görsellerinin görev devri Sürüm 23 kararlarında görünüyor, o sürümün
  aksiyonlarında yeni sorumluya atanmış görsel görevi görünmüyor. Eski saat 10
  hâlâ var; konuşmadaki 11 düzeltmesi bu ekrana yansımamış.
- İptal edilen görevin önceki listede görülmemesi nedeniyle sonraki yokluğu
  iptal işleminin doğru uygulandığını tek başına kanıtlamaz.
- Rapor Sürüm 26'da 8 aksiyon gösteriyor, ancak içeriği paylaşılmadı. Sürüm 23
  hatalarının en son sürümde de kesin sürdüğü iddia edilmedi. Sekiz aksiyon
  sayısı tek başına başarı değildir; iptal sonrası yedi doğru görev beklenir.

Mobil parseAnalysis yalnız sunucudan gelen action_items alanlarını doğrulayıp
gösterir; newerAnalysis sürümleri değiştirir. İstemcide farklı sürümleri körlemesine
birleştirmek iptal/eski sorumlu/eski tarihi geri getirebilir; böyle bir yama yapılmadı.
Ortak noktalama, model, backend ve Electron bu düzeltmede değiştirilmedi.

## Başlatma gerilemesi ve 26 Eylül düzeltmesi

Kullanıcı normal yeni toplantıda eski kayıt engelinin tekrarlandığını, özel yeni
kayıt yolunun çalıştığını bildirdi. Raporda başarılı ikinci deneme var; ilk başarısız
denemenin satırları yok. Kodda normal begin tüm eski kayıtları uzlaştırırken yalnız
özel düğmede diğer toplantılar korunuyordu. Yeni davranış her giriş yolunda yalnız
seçili toplantının kapanışını kontrol eder; diğer toplantıların bilgilerini saklar.
Aynı toplantının belirsiz kaydı, etkin mikrofon, hesap/bozuk veri/kapasite kontrolleri
korunur. Özel UI bayrağı kaldırıldı. Bu değişiklik analiz hatalarını çözmez.

Takip: platform-mobile #7 ve #8, PR47. Canlı teslim bu denemede doğrulandı; doğru
görev kümesi, görev devri/iptali, tarih ve gecikme kabulü açık.
