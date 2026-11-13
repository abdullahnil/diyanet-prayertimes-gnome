// UI strings. Prayer names match NilTab Web.

const HIJRI_MONTHS = {
    tr: ['Muharrem', 'Safer', 'Rebiülevvel', 'Rebiülahir', 'Cemaziyelevvel', 'Cemaziyelahir',
        'Recep', 'Şaban', 'Ramazan', 'Şevval', 'Zilkade', 'Zilhicce'],
    en: ['Muharram', 'Safar', 'Rabi al-Awwal', 'Rabi al-Thani', 'Jumada al-Ula', 'Jumada al-Akhirah',
        'Rajab', "Sha'ban", 'Ramadan', 'Shawwal', "Dhu al-Qi'dah", 'Dhu al-Hijjah'],
};

const STRINGS = {
    tr: {
        locale: 'tr-TR',
        names: {imsak: 'İmsak', gunes: 'Güneş', ogle: 'Öğle', ikindi: 'İkindi', aksam: 'Akşam', yatsi: 'Yatsı'},
        // Dative forms for the panel: "İkindiye 0.20.35"
        until: {imsak: 'İmsaka', gunes: 'Güneşe', ogle: 'Öğleye', ikindi: 'İkindiye', aksam: 'Akşama', yatsi: 'Yatsıya'},
        panel: (key, time, s) => `${s.until[key]} ${time}`,
        remaining: (key, time, s) => `${s.names[key]} vaktine ${time} kaldı`,
        loading: 'Vakitler yükleniyor…',
        error: 'Vakitler alınamadı',
        errorHint: 'İnternet bağlantınızı ve ayarlardaki konumu kontrol edin.',
        offline: 'Çevrimdışı – kayıtlı veriler gösteriliyor',
        tzMismatch: 'Uyarı: bilgisayarın saat dilimi seçili şehirden farklı, geri sayım kayık olabilir.',
        refresh: 'Yenile',
        settings: 'Ayarlar',
        sourceDiyanet: 'Kaynak: Diyanet İşleri Başkanlığı',
        sourceAladhan: 'Kaynak: Aladhan (hesaplama, ±1-2 dk sapabilir)',
        tomorrow: 'yarın',
    },
    en: {
        locale: 'en-US',
        names: {imsak: 'Fajr', gunes: 'Sunrise', ogle: 'Dhuhr', ikindi: 'Asr', aksam: 'Maghrib', yatsi: 'Isha'},
        until: null,
        panel: (key, time, s) => `${s.names[key]} in ${time}`,
        remaining: (key, time, s) => `${time} until ${s.names[key]}`,
        loading: 'Loading prayer times…',
        error: 'Could not load prayer times',
        errorHint: 'Check your internet connection and the location in settings.',
        offline: 'Offline – showing saved times',
        tzMismatch: 'Warning: your system time zone differs from the selected city, so the countdown may be off.',
        refresh: 'Refresh',
        settings: 'Settings',
        sourceDiyanet: 'Source: Presidency of Religious Affairs (Diyanet)',
        sourceAladhan: 'Source: Aladhan (calculated, may differ by 1-2 min)',
        tomorrow: 'tomorrow',
    },
};

export function getStrings(lang) {
    return STRINGS[lang] || STRINGS.tr;
}

export function hijriText(hijri, lang) {
    if (!hijri)
        return '';
    if (hijri.text)
        return hijri.text; // Diyanet already returns a Turkish long form
    const months = HIJRI_MONTHS[lang] || HIJRI_MONTHS.tr;
    const name = months[(hijri.month || 1) - 1] || '';
    return `${hijri.day} ${name} ${hijri.year}`;
}

// "İZMİR" -> "İzmir" (Turkish-aware title case for Diyanet's upper-case names)
export function titleCase(text, locale = 'tr-TR') {
    return String(text || '')
        .toLocaleLowerCase(locale)
        .replace(/(^|[\s\-(/])(\S)/g, (_, sep, ch) => sep + ch.toLocaleUpperCase(locale));
}
