// Data layer: fetching (Diyanet via NilTab proxy, Aladhan), caching and schedule math.
// No GNOME Shell imports here, so this module works in the shell, in prefs and in tests.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');
Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');

export const PRAYER_KEYS = ['imsak', 'gunes', 'ogle', 'ikindi', 'aksam', 'yatsi'];

export const DEFAULT_PROXY_URL = 'https://nilsaver.abdullahnil.com';

// Same calculation methods offered by NilTab Web.
export const ALADHAN_METHODS = [
    {id: 13, name: 'Diyanet İşleri Başkanlığı (Türkiye)'},
    {id: 3, name: 'Muslim World League (MWL)'},
    {id: 2, name: 'Islamic Society of North America (ISNA)'},
    {id: 4, name: 'Umm Al-Qura University, Makkah'},
    {id: 5, name: 'Egyptian General Authority of Survey'},
];

const DIYANET_FIELDS = {imsak: 'fajr', gunes: 'sunrise', ogle: 'dhuhr', ikindi: 'asr', aksam: 'maghrib', yatsi: 'isha'};
const ALADHAN_FIELDS = {imsak: 'Fajr', gunes: 'Sunrise', ogle: 'Dhuhr', ikindi: 'Asr', aksam: 'Maghrib', yatsi: 'Isha'};

// ---------------------------------------------------------------------------
// HTTP

export function createSession() {
    return new Soup.Session({timeout: 20, user_agent: 'prayer-times-nil/1.0'});
}

export async function fetchJson(session, url, cancellable = null) {
    const message = Soup.Message.new('GET', url);
    if (!message)
        throw new Error(`Invalid URL: ${url}`);
    const bytes = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable);
    const status = message.get_status();
    if (status !== Soup.Status.OK)
        throw new Error(`HTTP ${status} (${url})`);
    return JSON.parse(new TextDecoder().decode(bytes.get_data()));
}

function trimSlash(url) {
    return String(url || DEFAULT_PROXY_URL).trim().replace(/\/+$/, '');
}

export function isCancelled(error) {
    return error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

// ---------------------------------------------------------------------------
// Date helpers

export function dayKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function addDays(date, n) {
    const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    copy.setDate(copy.getDate() + n);
    return copy;
}

// "06:19" or "06:19 (+03)" -> "06:19"
function cleanTime(value) {
    const m = String(value ?? '').match(/(\d{1,2}):(\d{2})/);
    if (!m)
        throw new Error(`Unexpected time value: ${value}`);
    return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function atTime(day, hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
}

// ---------------------------------------------------------------------------
// Diyanet (through the NilTab proxy)

export async function fetchDiyanetPlaces(session, proxyUrl, kind, id = null, cancellable = null) {
    let path;
    if (kind === 'Countries')
        path = '/api/Place/Countries';
    else if (kind === 'States' || kind === 'Cities')
        path = `/api/Place/${kind}/${Number(id)}`;
    else
        throw new Error(`Unknown place kind: ${kind}`);

    const res = await fetchJson(session, trimSlash(proxyUrl) + path, cancellable);
    if (!res?.success || !Array.isArray(res.data))
        throw new Error(res?.message || 'Diyanet place response invalid');
    return res.data.map(p => ({id: Number(p.id), name: String(p.name)}));
}

async function fetchDiyanetDays(session, proxyUrl, cityId, cancellable) {
    const res = await fetchJson(session, `${trimSlash(proxyUrl)}/api/PrayerTime/Monthly/${Number(cityId)}`, cancellable);
    if (!res?.success || !Array.isArray(res.data))
        throw new Error(res?.message || 'Diyanet prayer time response invalid');

    const days = {};
    for (const entry of res.data) {
        const m = String(entry.gregorianDateShort || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
        if (!m)
            continue;
        const times = {};
        for (const key of PRAYER_KEYS)
            times[key] = cleanTime(entry[DIYANET_FIELDS[key]]);
        days[`${m[3]}-${m[2]}-${m[1]}`] = {times, hijri: {text: entry.hijriDateLong || ''}};
    }
    return days;
}

// ---------------------------------------------------------------------------
// Aladhan (computed times)

async function fetchAladhanMonth(session, lat, lon, method, year, month, cancellable) {
    const url = `https://api.aladhan.com/v1/calendar/${year}/${month}` +
        `?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&method=${Number(method)}`;
    const res = await fetchJson(session, url, cancellable);
    if (!Array.isArray(res?.data))
        throw new Error('Aladhan response invalid');

    const days = {};
    for (const entry of res.data) {
        const m = String(entry?.date?.gregorian?.date || '').match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (!m)
            continue;
        const times = {};
        for (const key of PRAYER_KEYS)
            times[key] = cleanTime(entry.timings[ALADHAN_FIELDS[key]]);
        const h = entry.date.hijri;
        days[`${m[3]}-${m[2]}-${m[1]}`] = {
            times,
            hijri: {day: Number(h.day), month: Number(h.month?.number), year: Number(h.year)},
        };
    }
    return days;
}

// Open-Meteo geocoding (same service NilTab uses for city search).
export async function geocodeCity(session, query, language = 'tr', cancellable = null) {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}` +
        `&count=1&language=${encodeURIComponent(language)}&format=json`;
    const res = await fetchJson(session, url, cancellable);
    const r = res?.results?.[0];
    if (!r)
        return null;
    return {name: r.name, country: r.country || '', latitude: r.latitude, longitude: r.longitude};
}

// ---------------------------------------------------------------------------
// Config + cache

export function configFromSettings(settings) {
    return {
        source: settings.get_string('source'),
        proxyUrl: settings.get_string('proxy-url'),
        diyanetCityId: settings.get_int('diyanet-city-id'),
        latitude: settings.get_double('latitude'),
        longitude: settings.get_double('longitude'),
        method: settings.get_int('aladhan-method'),
    };
}

function configSignature(cfg) {
    if (cfg.source === 'diyanet')
        return `diyanet:${cfg.diyanetCityId}`;
    return `aladhan:${cfg.latitude.toFixed(4)},${cfg.longitude.toFixed(4)}:${cfg.method}`;
}

export class PrayerStore {
    constructor(session, cacheFilePath) {
        this._session = session;
        this._file = Gio.File.new_for_path(cacheFilePath);
        this._data = {signature: null, days: {}};
        this._loaded = false;
    }

    async _load() {
        if (this._loaded)
            return;
        this._loaded = true;
        try {
            const [contents] = await this._file.load_contents_async(null);
            const parsed = JSON.parse(new TextDecoder().decode(contents));
            if (parsed && typeof parsed.days === 'object')
                this._data = parsed;
        } catch (e) {
            // Missing or corrupt cache: start empty.
        }
    }

    async _save() {
        const parent = this._file.get_parent();
        if (parent && !parent.query_exists(null))
            parent.make_directory_with_parents(null);
        const bytes = new GLib.Bytes(new TextEncoder().encode(JSON.stringify(this._data)));
        await this._file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    }

    getDay(date) {
        return this._data.days[dayKey(date)] || null;
    }

    hasData() {
        return Object.keys(this._data.days).length > 0;
    }

    // Make sure the given dates are available for this config; fetch only what is missing.
    async ensure(cfg, dates, {cancellable = null, force = false} = {}) {
        await this._load();
        const signature = configSignature(cfg);
        if (this._data.signature !== signature) {
            this._data = {signature, days: {}};
        }

        const missing = dates.filter(d => force || !this._data.days[dayKey(d)]);
        if (missing.length === 0)
            return false;

        let fetched = {};
        if (cfg.source === 'diyanet') {
            fetched = await fetchDiyanetDays(this._session, cfg.proxyUrl, cfg.diyanetCityId, cancellable);
        } else {
            const months = new Set(missing.map(d => `${d.getFullYear()}-${d.getMonth() + 1}`));
            for (const ym of months) {
                const [y, m] = ym.split('-').map(Number);
                Object.assign(fetched, await fetchAladhanMonth(
                    this._session, cfg.latitude, cfg.longitude, cfg.method, y, m, cancellable));
            }
        }

        if (Object.keys(fetched).length === 0)
            throw new Error('No prayer times returned');

        // Keep a small window of days: drop anything older than yesterday.
        const oldest = dayKey(addDays(new Date(), -1));
        const days = {...this._data.days, ...fetched};
        for (const k of Object.keys(days)) {
            if (k < oldest)
                delete days[k];
        }
        this._data = {signature, days, fetchedAt: Date.now()};
        await this._save();
        return true;
    }
}

// ---------------------------------------------------------------------------
// Schedule

// Returns null when today's times are unknown.
export function computeState(store, now = new Date()) {
    const today = store.getDay(now);
    if (!today)
        return null;

    const todayStart = addDays(now, 0);
    const events = PRAYER_KEYS.map(key => ({key, time: today.times[key], date: atTime(todayStart, today.times[key])}));

    const tomorrow = store.getDay(addDays(now, 1));
    const tomorrowImsak = tomorrow
        ? atTime(addDays(now, 1), tomorrow.times.imsak)
        : new Date(events[0].date.getTime() + 24 * 3600 * 1000);

    const nextIdx = events.findIndex(e => e.date > now);
    let next, currentKey;
    if (nextIdx === -1) {
        next = {key: 'imsak', date: tomorrowImsak, tomorrow: true};
        currentKey = 'yatsi';
    } else {
        next = events[nextIdx];
        currentKey = nextIdx === 0 ? 'yatsi' : events[nextIdx - 1].key; // before imsak: still yesterday's yatsı
    }

    const remainingSec = Math.max(0, Math.floor((next.date.getTime() - now.getTime()) / 1000));
    return {day: today, events, next, currentKey, nextIdx, remainingSec};
}

// 1235 -> "0.20.35" (with seconds) or "0.20"
export function formatCountdown(totalSec, showSeconds = true) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const mm = String(m).padStart(2, '0');
    return showSeconds ? `${h}.${mm}.${String(s).padStart(2, '0')}` : `${h}.${mm}`;
}
