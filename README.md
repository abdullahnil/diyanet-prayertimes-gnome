# Prayer Times Nil 🌙

GNOME Shell (50) eklentisi. Üst panelde bir sonraki namaz vaktine geri sayım gösterir:

```
İkindiye 0.20.35
```

Panele tıklayınca GNOME temasına uyan küçük bir menü açılır: şehir, miladi ve hicri tarih,
"İkindi vaktine 0.20.35 kaldı" satırı, günün altı vakti (geçenler soluk, içinde bulunulan vakit vurgulu),
**Yenile** ve **Ayarlar**.

## Vakit kaynakları (NilTab Web ile aynı)

- **Diyanet (resmi):** NilTab'ın Diyanet proxy'si (`nilsaver.abdullahnil.com`) üzerinden.
  Ayarlarda Ülke → İl → İlçe seçilir.
- **Aladhan (hesaplama):** Şehir aranır (Open-Meteo), 5 hesaplama yönteminden biri seçilir
  (Diyanet, MWL, ISNA, Umm Al-Qura, Mısır). 1-2 dakika sapabilir.

Vakitler `~/.cache/prayer-times-nil/times.json` dosyasında saklanır (Diyanet için ~1 ay).
İnternet yokken kayıtlı vakitler kullanılır; ağ isteği yalnızca veri eksikse atılır.

Not: Saatler seçilen şehrin yerel saatidir; bilgisayarın saat dilimi de o şehirle aynı olmalıdır.
Farklıysa menüde uyarı gösterilir.

Aladhan'da şehir ararken birden fazla sonuç çıkarsa (aynı adlı şehirler) listeden doğrusu seçilir.

## Kurulum

```bash
./install.sh
```

Wayland'de yeni bir eklenti oturum açılışında yüklenir: oturumu kapatıp açın, sonra

```bash
gnome-extensions enable prayer-times-nil@abdullahnil
```

Ayarlar: menüdeki **Ayarlar** ya da `gnome-extensions prefs prayer-times-nil@abdullahnil`.

## Geliştirme

```
extension.js        Panel göstergesi + menü
prefs.js            Ayarlar penceresi (Adwaita)
lib/prayerData.js   Ağ, önbellek, vakit hesaplama (shell'den bağımsız)
lib/i18n.js         Türkçe / İngilizce metinler
schemas/            GSettings şeması
tests/unit.js       Çevrimdışı testler (ayrıştırma, vakit hesabı, biçimlendirme)
tests/run.js        Uçtan uca testler (gerçek servislere istek atar)
```

```bash
gjs -m tests/unit.js   # hızlı, ağ gerekmez
gjs -m tests/run.js    # Diyanet proxy, Aladhan ve Open-Meteo'ya istek atar
```

extensions.gnome.org için paket: `./install.sh --pack`

Kod değişikliğinden sonra `./install.sh` çalıştırıp oturumu yeniden açın. Hızlı deneme için iç içe
(nested) bir shell: `dbus-run-session gnome-shell --devkit --wayland`.

Hata günlükleri: `journalctl --user -f -o cat /usr/bin/gnome-shell | grep prayer-times-nil`

## Lisans

GPL-2.0-or-later — bkz. [LICENSE](LICENSE).
