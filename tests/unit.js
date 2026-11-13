// Run with: gjs -m tests/unit.js
// Offline tests: parsing, schedule math and formatting with fixed data (no network, no clock dependency).

import {
    computeState, formatCountdown, parseDiyanetDays, parseAladhanMonth, configSignature, dayKey, addDays,
} from '../lib/prayerData.js';
import {getStrings, hijriText, titleCase} from '../lib/i18n.js';
import System from 'system';

let failures = 0;
function check(name, cond, extra = '') {
    print(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
    if (!cond)
        failures++;
}

// Local-time helper: 2026-11-14 at h:m:s.
const at = (h, m, s = 0, dayOffset = 0) => new Date(2026, 10, 14 + dayOffset, h, m, s);
const systemOffsetMin = -at(12, 0).getTimezoneOffset();

const TIMES = {imsak: '06:20', gunes: '07:45', ogle: '13:01', ikindi: '15:43', aksam: '18:07', yatsi: '19:26'};
const TOMORROW = {imsak: '06:21', gunes: '07:46', ogle: '13:01', ikindi: '15:43', aksam: '18:06', yatsi: '19:25'};

function fakeStore(days) {
    return {getDay: date => days[dayKey(date)] || null};
}
const store = fakeStore({
    '2026-11-14': {times: TIMES, hijri: {day: 5, month: 6, year: 1448}, utcOffsetMin: systemOffsetMin},
    '2026-11-15': {times: TOMORROW, hijri: {day: 6, month: 6, year: 1448}, utcOffsetMin: systemOffsetMin},
});

// ---- formatting
check('formatCountdown seconds', formatCountdown(1235) === '0.20.35', formatCountdown(1235));
check('formatCountdown no seconds', formatCountdown(3 * 3600 + 5 * 60 + 9, false) === '3.05');
check('formatCountdown zero', formatCountdown(0) === '0.00.00');
check('titleCase', titleCase('İZMİR') === 'İzmir' && titleCase('KUZEY KIBRIS') === 'Kuzey Kıbrıs', titleCase('KUZEY KIBRIS'));
const tr = getStrings('tr');
const en = getStrings('en');
check('panel text tr', tr.panel('ikindi', '0.20.35', tr) === 'İkindiye 0.20.35');
check('panel text en', en.panel('ikindi', '0.20.35', en) === 'Asr in 0.20.35');
check('unknown language falls back to tr', getStrings('xx') === tr);

// ---- hijri
check('hijri tr', hijriText({day: 5, month: 6, year: 1448}, 'tr') === '5 Cemaziyelahir 1448');
check('hijri en', hijriText({day: 5, month: 6, year: 1448}, 'en') === '5 Jumada al-Akhirah 1448');
check('hijri legacy text', hijriText({text: '5 Cemaziyelahir 1448'}, 'en') === '5 Cemaziyelahir 1448');
check('hijri missing', hijriText(null, 'tr') === '');

// ---- schedule
check('no data -> null', computeState(fakeStore({}), at(12, 0)) === null);

let st = computeState(store, at(6, 19));
check('1 min before imsak', st.next.key === 'imsak' && st.currentKey === 'yatsi' && st.nextIdx === 0 &&
    st.remainingSec === 60);

st = computeState(store, at(0, 30));
check('after midnight -> imsak, yatsı is yesterday\'s', st.next.key === 'imsak' && st.nextIdx === 0);

st = computeState(store, at(15, 43, 0));
check('exactly at ikindi -> next is akşam', st.next.key === 'aksam' && st.currentKey === 'ikindi');

st = computeState(store, at(15, 22, 25));
const text = tr.panel(st.next.key, formatCountdown(st.remainingSec), tr);
check('20m35s before ikindi', text === 'İkindiye 0.20.35', text);

st = computeState(store, at(19, 27));
check('after yatsı -> tomorrow imsak', st.next.key === 'imsak' && st.next.tomorrow === true && st.nextIdx === -1 &&
    st.currentKey === 'yatsi');
check('after yatsı uses tomorrow\'s imsak', st.remainingSec === (24 * 60 - (19 * 60 + 27) + 6 * 60 + 21) * 60,
    formatCountdown(st.remainingSec));

const onlyToday = fakeStore({'2026-11-14': {times: TIMES, hijri: null}});
st = computeState(onlyToday, at(23, 0));
check('after yatsı without tomorrow -> today imsak + 24h', st.next.tomorrow && st.remainingSec === (60 + 6 * 60 + 20) * 60);

check('same time zone -> no warning', computeState(store, at(12, 0)).tzMismatch === false);
const otherZone = fakeStore({'2026-11-14': {times: TIMES, hijri: null, utcOffsetMin: systemOffsetMin + 60}});
check('other time zone -> warning', computeState(otherZone, at(12, 0)).tzMismatch === true);
const unknownZone = fakeStore({'2026-11-14': {times: TIMES, hijri: null}});
check('unknown time zone -> no warning', computeState(unknownZone, at(12, 0)).tzMismatch === false);

// ---- date helpers
check('addDays across month', dayKey(addDays(new Date(2026, 10, 30, 22, 0), 1)) === '2026-12-01');
check('addDays across year', dayKey(addDays(new Date(2026, 11, 31), 1)) === '2027-01-01');

// ---- parsing
const diyanet = parseDiyanetDays({
    success: true,
    data: [{
        fajr: '06:18', sunrise: '07:42', dhuhr: '13:01', asr: '15:44', maghrib: '18:09', isha: '19:28',
        hijriDateShort: '3.6.1448', hijriDateLong: '3 Cemaziyelahir 1448',
        gregorianDateShort: '12.11.2026', greenwichMeanTimeZone: 3,
    }, {gregorianDateShort: 'garbage'}],
});
const d = diyanet['2026-11-12'];
check('diyanet parse', Object.keys(diyanet).length === 1 && d.times.ikindi === '15:44' && d.times.yatsi === '19:28');
check('diyanet hijri parts', d.hijri.day === 3 && d.hijri.month === 6 && d.hijri.year === 1448);
check('diyanet utc offset', d.utcOffsetMin === 180);
let threw = false;
try {
    parseDiyanetDays({success: false, message: 'nope'});
} catch (e) {
    threw = e.message === 'nope';
}
check('diyanet error response throws', threw);

const aladhan = parseAladhanMonth({
    data: [{
        timings: {Fajr: '06:20 (+03)', Sunrise: '07:45 (+03)', Dhuhr: '13:01 (+03)', Asr: '15:44 (+03)',
            Maghrib: '18:07 (+03)', Isha: '19:26 (+03)'},
        date: {gregorian: {date: '14-11-2026'}, hijri: {day: '4', month: {number: 6}, year: '1448'}},
        meta: {timezone: 'Europe/Istanbul'},
    }],
});
const a = aladhan['2026-11-14'];
check('aladhan parse strips zone', a.times.imsak === '06:20' && a.times.yatsi === '19:26');
check('aladhan hijri', a.hijri.day === 4 && a.hijri.month === 6 && a.hijri.year === 1448);
check('aladhan utc offset from zone', a.utcOffsetMin === 180, String(a.utcOffsetMin));

// ---- cache signature
const base = {source: 'aladhan', proxyUrl: '', diyanetCityId: 0, latitude: 38.4127, longitude: 27.1384, method: 13};
check('signature changes with method', configSignature(base) !== configSignature({...base, method: 3}));
check('signature ignores aladhan fields for diyanet',
    configSignature({...base, source: 'diyanet', diyanetCityId: 9560}) ===
    configSignature({...base, source: 'diyanet', diyanetCityId: 9560, latitude: 1}));

print(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0)
    System.exit(1);
