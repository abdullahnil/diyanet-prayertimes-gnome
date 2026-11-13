import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    createSession, fetchDiyanetPlaces, searchCities, isCancelled, ALADHAN_METHODS,
} from './lib/prayerData.js';
import {titleCase} from './lib/i18n.js';

const T = {
    tr: {
        pageLocation: 'Konum', pageAppearance: 'Görünüm',
        sourceGroup: 'Vakit kaynağı',
        sourceDesc: 'NilTab Web ile aynı seçenekler.',
        source: 'Kaynak',
        sourceDiyanet: 'Diyanet (resmi)', sourceAladhan: 'Aladhan (hesaplama)',
        diyanetGroup: 'Diyanet konumu',
        diyanetDesc: 'Vakitler NilTab Diyanet proxy\'si üzerinden alınır.',
        country: 'Ülke', state: 'İl / Eyalet', city: 'İlçe / Şehir',
        loading: 'Yükleniyor…', loadError: 'Liste alınamadı', retry: 'Tekrar dene',
        aladhanGroup: 'Hesaplama konumu',
        aladhanDesc: 'Matematiksel hesaplama; resmi Diyanet takviminden 1-2 dakika sapabilir.',
        searchCity: 'Şehir ara', currentLocation: 'Seçili konum',
        searching: 'Aranıyor…', notFound: 'Şehir bulunamadı', searchError: 'Arama başarısız',
        resultsGroup: 'Arama sonuçları', resultsDesc: 'Doğru şehri seçin.', emptyList: 'Liste boş geldi',
        method: 'Hesaplama yöntemi',
        appearanceGroup: 'Panel',
        language: 'Dil', showSeconds: 'Saniyeleri göster',
        showSecondsDesc: 'Örn. "İkindiye 0.20.35" yerine "İkindiye 0.20"',
        position: 'Paneldeki konum', left: 'Sol', center: 'Orta', right: 'Sağ',
        advancedGroup: 'Gelişmiş', proxyUrl: 'Diyanet proxy adresi',
    },
    en: {
        pageLocation: 'Location', pageAppearance: 'Appearance',
        sourceGroup: 'Prayer time source',
        sourceDesc: 'Same options as NilTab Web.',
        source: 'Source',
        sourceDiyanet: 'Diyanet (official)', sourceAladhan: 'Aladhan (calculated)',
        diyanetGroup: 'Diyanet location',
        diyanetDesc: 'Times are fetched through the NilTab Diyanet proxy.',
        country: 'Country', state: 'State / Province', city: 'City / District',
        loading: 'Loading…', loadError: 'Could not load list', retry: 'Retry',
        aladhanGroup: 'Calculation location',
        aladhanDesc: 'Mathematical calculation; may differ from the official Diyanet calendar by 1-2 minutes.',
        searchCity: 'Search city', currentLocation: 'Selected location',
        searching: 'Searching…', notFound: 'City not found', searchError: 'Search failed',
        resultsGroup: 'Search results', resultsDesc: 'Pick the right city.', emptyList: 'The list came back empty',
        method: 'Calculation method',
        appearanceGroup: 'Panel',
        language: 'Language', showSeconds: 'Show seconds',
        showSecondsDesc: 'E.g. "Asr in 0.20.35" instead of "Asr in 0.20"',
        position: 'Position in panel', left: 'Left', center: 'Center', right: 'Right',
        advancedGroup: 'Advanced', proxyUrl: 'Diyanet proxy URL',
    },
};

function makeCombo(title, labels) {
    const row = new Adw.ComboRow({title, model: Gtk.StringList.new(labels)});
    return row;
}

export default class DiyanetPrayerTimesPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const t = T[settings.get_string('language')] || T.tr;
        const session = createSession();
        const cancellable = new Gio.Cancellable();
        window.connect('close-request', () => {
            cancellable.cancel();
            session.abort();
            return false;
        });
        window.set_default_size(560, 680);

        // ================= Location page =================
        const locPage = new Adw.PreferencesPage({title: t.pageLocation, icon_name: 'mark-location-symbolic'});
        window.add(locPage);

        // --- Source
        const sourceGroup = new Adw.PreferencesGroup({title: t.sourceGroup, description: t.sourceDesc});
        locPage.add(sourceGroup);
        const sourceValues = ['diyanet', 'aladhan'];
        const sourceRow = makeCombo(t.source, [t.sourceDiyanet, t.sourceAladhan]);
        sourceRow.selected = Math.max(0, sourceValues.indexOf(settings.get_string('source')));
        sourceGroup.add(sourceRow);

        // --- Diyanet cascading selectors
        const diyanetGroup = new Adw.PreferencesGroup({title: t.diyanetGroup, description: t.diyanetDesc});
        locPage.add(diyanetGroup);
        const countryRow = new Adw.ComboRow({title: t.country, enable_search: true});
        const stateRow = new Adw.ComboRow({title: t.state, enable_search: true});
        const cityRow = new Adw.ComboRow({title: t.city, enable_search: true});
        const diyanetStatus = new Adw.ActionRow({title: '', visible: false});
        const retryButton = new Gtk.Button({label: t.retry, valign: Gtk.Align.CENTER});
        diyanetStatus.add_suffix(retryButton);
        for (const r of [countryRow, stateRow, cityRow, diyanetStatus])
            diyanetGroup.add(r);

        const lists = {country: [], state: [], city: []};
        let updating = false;

        const setList = (row, key, items) => {
            lists[key] = items;
            const model = Gtk.StringList.new(items.map(p => titleCase(p.name)));
            updating = true;
            row.model = model;
            row.sensitive = items.length > 0;
            updating = false;
        };
        const selectId = (row, key, id) => {
            const idx = lists[key].findIndex(p => p.id === id);
            updating = true;
            row.selected = idx >= 0 ? idx : 0;
            updating = false;
            return lists[key][idx >= 0 ? idx : 0];
        };
        const showStatus = (text, withRetry = false) => {
            diyanetStatus.title = text || '';
            diyanetStatus.visible = !!text;
            retryButton.visible = withRetry;
        };
        const placeholder = (row, text) => {
            updating = true;
            row.model = Gtk.StringList.new([text]);
            row.sensitive = false;
            updating = false;
        };
        const proxy = () => settings.get_string('proxy-url');

        const saveCity = city => {
            if (!city)
                return;
            settings.set_int('diyanet-city-id', city.id);
            settings.set_string('diyanet-city-name', city.name);
        };

        // Every user action starts a new load "generation"; answers of older loads
        // (e.g. a slow reply for a previously selected country) are ignored.
        let generation = 0;
        const isStale = gen => gen !== generation;

        const loadCities = async (gen, stateId, preferredCityId) => {
            placeholder(cityRow, t.loading);
            const cities = await fetchDiyanetPlaces(session, proxy(), 'Cities', stateId, cancellable);
            if (isStale(gen))
                return;
            setList(cityRow, 'city', cities);
            if (cities.length > 0)
                saveCity(selectId(cityRow, 'city', preferredCityId));
        };
        const loadStates = async (gen, countryId, preferredStateId, preferredCityId) => {
            placeholder(stateRow, t.loading);
            placeholder(cityRow, t.loading);
            const states = await fetchDiyanetPlaces(session, proxy(), 'States', countryId, cancellable);
            if (isStale(gen))
                return;
            setList(stateRow, 'state', states);
            if (states.length === 0) {
                setList(cityRow, 'city', []);
                return;
            }
            const state = selectId(stateRow, 'state', preferredStateId);
            settings.set_int('diyanet-state-id', state.id);
            await loadCities(gen, state.id, preferredCityId);
        };
        const run = fn => {
            const gen = ++generation;
            showStatus('');
            fn(gen).catch(e => {
                if (!isCancelled(e) && !isStale(gen))
                    showStatus(`${t.loadError}: ${e.message ?? e}`, true);
            });
        };
        const loadAll = () => run(async gen => {
            placeholder(countryRow, t.loading);
            const countries = await fetchDiyanetPlaces(session, proxy(), 'Countries', null, cancellable);
            if (isStale(gen))
                return;
            if (countries.length === 0)
                throw new Error(t.emptyList);
            setList(countryRow, 'country', countries);
            const country = selectId(countryRow, 'country', settings.get_int('diyanet-country-id'));
            await loadStates(gen, country.id, settings.get_int('diyanet-state-id'), settings.get_int('diyanet-city-id'));
        });
        retryButton.connect('clicked', () => loadAll());

        countryRow.connect('notify::selected', () => {
            if (updating)
                return;
            const country = lists.country[countryRow.selected];
            if (!country)
                return;
            settings.set_int('diyanet-country-id', country.id);
            run(gen => loadStates(gen, country.id, -1, -1));
        });
        stateRow.connect('notify::selected', () => {
            if (updating)
                return;
            const state = lists.state[stateRow.selected];
            if (!state)
                return;
            settings.set_int('diyanet-state-id', state.id);
            run(gen => loadCities(gen, state.id, -1));
        });
        cityRow.connect('notify::selected', () => {
            if (updating)
                return;
            saveCity(lists.city[cityRow.selected]);
        });

        // --- Aladhan: city search + method
        const aladhanGroup = new Adw.PreferencesGroup({title: t.aladhanGroup, description: t.aladhanDesc});
        locPage.add(aladhanGroup);
        const currentRow = new Adw.ActionRow({title: t.currentLocation});
        const updateCurrent = () => {
            currentRow.subtitle = `${settings.get_string('aladhan-city-name')} ` +
                `(${settings.get_double('latitude').toFixed(4)}, ${settings.get_double('longitude').toFixed(4)})`;
        };
        updateCurrent();
        const searchRow = new Adw.EntryRow({title: t.searchCity, show_apply_button: true});

        // Several places can share a name, so list the matches and let the user pick.
        const resultsGroup = new Adw.PreferencesGroup({title: t.resultsGroup, description: t.resultsDesc, visible: false});
        let resultRows = [];
        const clearResults = () => {
            for (const row of resultRows)
                resultsGroup.remove(row);
            resultRows = [];
            resultsGroup.visible = false;
        };
        const applyCity = result => {
            settings.set_string('aladhan-city-name', result.country ? `${result.name}, ${result.country}` : result.name);
            settings.set_double('latitude', result.latitude);
            settings.set_double('longitude', result.longitude);
            searchRow.text = '';
            clearResults();
            updateCurrent();
        };
        let searchId = 0;
        searchRow.connect('apply', async () => {
            const query = searchRow.text.trim();
            if (!query)
                return;
            const id = ++searchId;
            clearResults();
            currentRow.subtitle = t.searching;
            try {
                const results = await searchCities(session, query, settings.get_string('language'), cancellable);
                if (id !== searchId)
                    return;
                if (results.length === 0) {
                    currentRow.subtitle = t.notFound;
                    return;
                }
                if (results.length === 1) {
                    applyCity(results[0]);
                    return;
                }
                updateCurrent();
                for (const r of results) {
                    const row = new Adw.ActionRow({
                        title: r.name,
                        subtitle: [r.region, r.country].filter(Boolean).join(', '),
                        activatable: true,
                    });
                    row.add_suffix(new Gtk.Image({icon_name: 'go-next-symbolic'}));
                    row.connect('activated', () => applyCity(r));
                    resultsGroup.add(row);
                    resultRows.push(row);
                }
                resultsGroup.visible = true;
            } catch (e) {
                if (!isCancelled(e) && id === searchId)
                    currentRow.subtitle = `${t.searchError}: ${e.message ?? e}`;
            }
        });
        const methodRow = makeCombo(t.method, ALADHAN_METHODS.map(m => m.name));
        methodRow.selected = Math.max(0, ALADHAN_METHODS.findIndex(m => m.id === settings.get_int('aladhan-method')));
        methodRow.connect('notify::selected', () => {
            settings.set_int('aladhan-method', ALADHAN_METHODS[methodRow.selected].id);
        });
        aladhanGroup.add(currentRow);
        aladhanGroup.add(searchRow);
        aladhanGroup.add(methodRow);
        locPage.add(resultsGroup);

        // --- Source switching
        let diyanetLoaded = false;
        const applySource = () => {
            const isDiyanet = sourceValues[sourceRow.selected] === 'diyanet';
            diyanetGroup.visible = isDiyanet;
            aladhanGroup.visible = !isDiyanet;
            if (isDiyanet)
                clearResults();
            if (isDiyanet && !diyanetLoaded) {
                diyanetLoaded = true;
                loadAll();
            }
        };
        sourceRow.connect('notify::selected', () => {
            settings.set_string('source', sourceValues[sourceRow.selected]);
            applySource();
        });
        applySource();

        // ================= Appearance page =================
        const appPage = new Adw.PreferencesPage({title: t.pageAppearance, icon_name: 'preferences-desktop-appearance-symbolic'});
        window.add(appPage);
        const appGroup = new Adw.PreferencesGroup({title: t.appearanceGroup});
        appPage.add(appGroup);

        const langValues = ['tr', 'en'];
        const langRow = makeCombo(t.language, ['Türkçe', 'English']);
        langRow.selected = Math.max(0, langValues.indexOf(settings.get_string('language')));
        langRow.connect('notify::selected', () => settings.set_string('language', langValues[langRow.selected]));
        appGroup.add(langRow);

        const secondsRow = new Adw.SwitchRow({title: t.showSeconds, subtitle: t.showSecondsDesc});
        settings.bind('show-seconds', secondsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        appGroup.add(secondsRow);

        const posValues = ['left', 'center', 'right'];
        const posRow = makeCombo(t.position, [t.left, t.center, t.right]);
        posRow.selected = Math.max(0, posValues.indexOf(settings.get_string('panel-position')));
        posRow.connect('notify::selected', () => settings.set_string('panel-position', posValues[posRow.selected]));
        appGroup.add(posRow);

        const advGroup = new Adw.PreferencesGroup({title: t.advancedGroup});
        appPage.add(advGroup);
        const proxyRow = new Adw.EntryRow({title: t.proxyUrl, show_apply_button: true, text: settings.get_string('proxy-url')});
        proxyRow.connect('apply', () => {
            const value = proxyRow.text.trim();
            if (/^https?:\/\/\S+$/.test(value)) {
                settings.set_string('proxy-url', value);
                diyanetLoaded = false;
                applySource();
            } else {
                proxyRow.text = settings.get_string('proxy-url');
            }
        });
        advGroup.add(proxyRow);

    }
}
