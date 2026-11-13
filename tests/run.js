// Run with: gjs -m tests/run.js
// Exercises the data layer against the real services (Diyanet via proxy, Aladhan) and the schedule math.

import GLib from 'gi://GLib';
import {
    PrayerStore, computeState, formatCountdown, createSession, fetchDiyanetPlaces,
    geocodeCity, addDays, DEFAULT_PROXY_URL,
} from '../lib/prayerData.js';
import {getStrings, hijriText, titleCase} from '../lib/i18n.js';

let failures = 0;
function check(name, cond, extra = '') {
    print(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
    if (!cond)
        failures++;
}

const loop = new GLib.MainLoop(null, false);
const tmp = GLib.dir_make_tmp('ptn-test-XXXXXX');

async function main() {
    const session = createSession();

    // Formatting
    check('formatCountdown seconds', formatCountdown(1235) === '0.20.35', formatCountdown(1235));
    check('formatCountdown no seconds', formatCountdown(3 * 3600 + 5 * 60 + 9, false) === '3.05');
    check('titleCase', titleCase('İZMİR') === 'İzmir' && titleCase('KUZEY KIBRIS') === 'Kuzey Kıbrıs', titleCase('KUZEY KIBRIS'));
    const tr = getStrings('tr');
    check('panel text tr', tr.panel('ikindi', '0.20.35', tr) === 'İkindiye 0.20.35');

    // Diyanet places through the proxy
    const countries = await fetchDiyanetPlaces(session, DEFAULT_PROXY_URL, 'Countries');
    check('diyanet countries', countries.some(c => c.id === 2), `${countries.length} countries`);
    const cities = await fetchDiyanetPlaces(session, DEFAULT_PROXY_URL, 'Cities', 540);
    check('diyanet cities of state 540', cities.some(c => c.id === 9560), `${cities.length} cities`);

    // Diyanet prayer times + cache
    const now = new Date();
    const dCfg = {source: 'diyanet', proxyUrl: DEFAULT_PROXY_URL, diyanetCityId: 9560, latitude: 0, longitude: 0, method: 13};
    const store = new PrayerStore(session, `${tmp}/diyanet.json`);
    const fetched = await store.ensure(dCfg, [now, addDays(now, 1)]);
    check('diyanet fetch', fetched === true);
    const st = computeState(store, now);
    check('diyanet state today', st !== null, st ? `next=${st.next.key} in ${formatCountdown(st.remainingSec)}` : '');
    check('diyanet hijri', !!hijriText(st?.day.hijri, 'tr'), hijriText(st?.day.hijri, 'tr'));
    print(`     ${Object.entries(st.day.times).map(([k, v]) => `${k}=${v}`).join(' ')}`);

    const store2 = new PrayerStore(session, `${tmp}/diyanet.json`);
    const refetched = await store2.ensure(dCfg, [now, addDays(now, 1)]);
    check('cache reused (no refetch)', refetched === false);

    // Schedule edge cases using today's real times
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const at = (h, m, s = 0) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, s);
    const [ih, im] = st.day.times.imsak.split(':').map(Number);
    const [ah, am] = st.day.times.ikindi.split(':').map(Number);
    const [yh, ym] = st.day.times.yatsi.split(':').map(Number);

    const beforeImsak = computeState(store, at(ih, im - 1));
    check('1 min before imsak', beforeImsak.next.key === 'imsak' && beforeImsak.currentKey === 'yatsi' && beforeImsak.remainingSec === 60);
    const atIkindi = computeState(store, at(ah, am, 0));
    check('exactly at ikindi -> next is akşam', atIkindi.next.key === 'aksam' && atIkindi.currentKey === 'ikindi');
    const before = computeState(store, at(ah, am - 21, 25));
    const beforeText = tr.panel(before.next.key, formatCountdown(before.remainingSec), tr);
    check('20m35s before ikindi', beforeText === 'İkindiye 0.20.35', beforeText);
    const afterYatsi = computeState(store, at(yh, ym + 1));
    check('after yatsı -> tomorrow imsak', afterYatsi.next.key === 'imsak' && afterYatsi.next.tomorrow === true,
        formatCountdown(afterYatsi.remainingSec));

    // Aladhan (computed) — İzmir coordinates, Diyanet method
    const aCfg = {source: 'aladhan', proxyUrl: '', diyanetCityId: 0, latitude: 38.4127, longitude: 27.1384, method: 13};
    const aStore = new PrayerStore(session, `${tmp}/aladhan.json`);
    await aStore.ensure(aCfg, [now, addDays(now, 1)]);
    const ast = computeState(aStore, now);
    check('aladhan state today', ast !== null, ast ? Object.values(ast.day.times).join(' ') : '');
    check('aladhan hijri', /\d+ \S+ \d{4}/.test(hijriText(ast?.day.hijri, 'tr')), hijriText(ast?.day.hijri, 'tr'));

    // Geocoding
    const geo = await geocodeCity(session, 'Ankara');
    check('geocode Ankara', geo && Math.abs(geo.latitude - 39.9) < 0.5, geo ? `${geo.name}, ${geo.country}` : 'null');
}

main().catch(e => {
    failures++;
    print(`FAIL exception: ${e}\n${e.stack}`);
}).finally(() => {
    GLib.spawn_command_line_sync(`rm -rf ${tmp}`);
    print(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURE(S)`);
    loop.quit();
});
loop.run();
