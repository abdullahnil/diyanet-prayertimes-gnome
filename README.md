# Diyanet Prayer Times 🌙

GNOME Shell (50) eklentisi. Üst panelde bir sonraki namaz vaktine geri sayım gösterir:

```
İkindiye 0.20.35
```

Panele tıklayınca GNOME temasına uyan küçük bir menü açılır: şehir, miladi ve hicri tarih,
"İkindi vaktine 0.20.35 kaldı" satırı, günün altı vakti (geçenler soluk, içinde bulunulan vakit vurgulu),
**Yenile** ve **Ayarlar**.

> Resmi değildir; Diyanet İşleri Başkanlığı ile bir bağı yoktur.

*[English below](#english)*

## Vakit kaynakları

- **Diyanet (resmi vakitler):** NilTab'ın Diyanet proxy'si (`nilsaver.abdullahnil.com`) üzerinden.
  Ayarlarda Ülke → İl → İlçe seçilir.
- **Aladhan (hesaplama):** Şehir aranır (Open-Meteo), 5 hesaplama yönteminden biri seçilir
  (Diyanet, MWL, ISNA, Umm Al-Qura, Mısır). 1-2 dakika sapabilir. Aynı adlı birden fazla şehir
  çıkarsa listeden doğrusu seçilir.

Vakitler `~/.cache/diyanet-prayertimes-gnome/times.json` dosyasında saklanır (Diyanet için ~1 ay).
İnternet yokken kayıtlı vakitler kullanılır; ağ isteği yalnızca veri eksikse atılır.

Not: Saatler seçilen şehrin yerel saatidir; bilgisayarın saat dilimi de o şehirle aynı olmalıdır.
Farklıysa menüde uyarı gösterilir.

## Gizlilik

Eklenti yalnızca vakitleri almak için şu servislere istek atar; takip/telemetri yoktur:

| Servis | Ne gönderilir | Ne zaman |
|---|---|---|
| `nilsaver.abdullahnil.com` (Diyanet proxy'si) | Seçilen ülke/il/ilçe kimliği | Diyanet seçiliyse, ayda ~1 kez ve ayarlarda liste açılınca |
| `api.aladhan.com` | Seçilen şehrin koordinatları | Aladhan seçiliyse, ayda ~1 kez |
| `geocoding-api.open-meteo.com` | Aranan şehir adı | Ayarlarda şehir aranınca |

## Kurulum

[extensions.gnome.org](https://extensions.gnome.org) üzerinden ya da kaynaktan:

```bash
./install.sh
```

Wayland'de yeni bir eklenti oturum açılışında yüklenir: oturumu kapatıp açın, sonra

```bash
gnome-extensions enable diyanet-prayertimes-gnome@abdullahnil.com
```

Ayarlar: menüdeki **Ayarlar** ya da `gnome-extensions prefs diyanet-prayertimes-gnome@abdullahnil.com`.

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

Kod değişikliğinden sonra `./install.sh` çalıştırıp oturumu yeniden açın. Hızlı deneme için iç içe
(nested) bir shell: `dbus-run-session gnome-shell --devkit --wayland`.

Hata günlükleri: `journalctl --user -f -o cat /usr/bin/gnome-shell | grep diyanet-prayertimes-gnome`

### Yeni sürüm yayınlama

1. `metadata.json` içindeki `version-name` değerini artırın (`version` alanını EGO kendisi atar).
2. `gjs -m tests/unit.js` ve `gjs -m tests/run.js`
3. `./install.sh --pack` → `diyanet-prayertimes-gnome@abdullahnil.com.shell-extension.zip`
4. Zip'i https://extensions.gnome.org/upload/ adresine yükleyin.

## English

A GNOME Shell extension that shows a countdown to the next prayer in the top bar
(e.g. `Asr in 0.20.35`) and today's prayer times with the Hijri date in a menu.
Unofficial; not affiliated with the Presidency of Religious Affairs (Diyanet).

- **Sources:** official Diyanet times (via the author's proxy, pick Country → State → City in
  settings) or times calculated by Aladhan (search a city, choose one of 5 methods).
- **Languages:** Turkish and English (Settings → Appearance).
- **Offline:** times are cached in `~/.cache/diyanet-prayertimes-gnome/`; the network is only used
  when data is missing (about once a month). See the privacy table above for exactly what is sent where.
- **Time zone:** times are in the city's local time; a warning is shown if your system time zone differs.

Install from extensions.gnome.org, or from source with `./install.sh`, then log out and back in and run
`gnome-extensions enable diyanet-prayertimes-gnome@abdullahnil.com`.

## Lisans / License

GPL-2.0-or-later — [LICENSE](LICENSE).
