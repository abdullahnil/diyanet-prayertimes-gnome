import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
    PrayerStore, computeState, formatCountdown, configFromSettings, createSession,
    addDays, dayKey, isCancelled,
} from './lib/prayerData.js';
import {getStrings, hijriText, titleCase} from './lib/i18n.js';

const RETRY_MIN_SECONDS = 60;
const RETRY_MAX_SECONDS = 30 * 60;
const SETTINGS_DEBOUNCE_MS = 300;
const PAST_OPACITY = 120;

// Settings that change which prayer times have to be fetched.
const FETCH_KEYS = ['source', 'proxy-url', 'diyanet-city-id', 'latitude', 'longitude', 'aladhan-method'];

// A menu item that is not clickable/hoverable but is not drawn dimmed like disabled items.
function infoItem(styleClass) {
    const item = new PopupMenu.PopupBaseMenuItem({
        reactive: false, activate: false, hover: false, can_focus: false, style_class: styleClass,
    });
    item.remove_style_class_name('popup-inactive-menu-item');
    item.remove_style_pseudo_class('insensitive');
    return item;
}

const PrayerIndicator = GObject.registerClass(
class PrayerIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.5, 'Prayer Times Nil', false);

        this._extension = extension;
        this._settings = extension.getSettings();
        this._cancellable = new Gio.Cancellable();
        this._session = createSession();
        const cachePath = GLib.build_filenamev([GLib.get_user_cache_dir(), 'prayer-times-nil', 'times.json']);
        this._store = new PrayerStore(this._session, cachePath);

        this._fetching = false;
        this._pendingReload = null; // {force} when a reload was requested while fetching
        this._error = null;
        this._lastAttempt = 0;
        this._retryDelay = RETRY_MIN_SECONDS;
        this._renderedSignature = null;
        this._tickId = 0;
        this._settingsTimeoutId = 0;
        this._pendingKeys = new Set();

        this._label = new St.Label({
            text: '…',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'ptn-panel-label',
        });
        this.add_child(this._label);

        this.menu.box.add_style_class_name('ptn-menu');
        // The menu always shows seconds, so tick every second while it is open.
        // (Guarded: destroying an open menu emits this after destroy() cleared the settings.)
        this.menu.connect('open-state-changed', () => {
            if (this._settings)
                this._restartTick();
        });

        this._settingsChangedId = this._settings.connect('changed', (_s, key) => this._onSettingChanged(key));

        // Retry right away when the network comes back instead of waiting for the backoff.
        this._networkMonitor = Gio.NetworkMonitor.get_default();
        this._networkChangedId = this._networkMonitor.connect('network-changed', (_m, available) => {
            if (available && this._error) {
                this._retryDelay = RETRY_MIN_SECONDS;
                this._reload(false);
            }
        });

        this._buildMenu();
        this._reload(false);
        this._scheduleTick();
    }

    // ---- settings ------------------------------------------------------

    // Preferences write several keys in a row (e.g. city name, latitude, longitude),
    // so collect them and apply once the burst is over.
    _onSettingChanged(key) {
        if (key === 'panel-position')
            return; // handled by the extension (re-adds the indicator)
        this._pendingKeys.add(key);
        if (this._settingsTimeoutId)
            GLib.source_remove(this._settingsTimeoutId);
        this._settingsTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTINGS_DEBOUNCE_MS, () => {
            this._settingsTimeoutId = 0;
            this._applySettingChanges();
            return GLib.SOURCE_REMOVE;
        });
    }

    _applySettingChanges() {
        const keys = [...this._pendingKeys];
        this._pendingKeys.clear();

        this._buildMenu();
        if (keys.some(k => FETCH_KEYS.includes(k))) {
            this._error = null;
            this._retryDelay = RETRY_MIN_SECONDS;
            this._reload(false);
        }
        this._restartTick();
    }

    get _strings() {
        return getStrings(this._settings.get_string('language'));
    }

    // ---- data ------------------------------------------------------------

    async _reload(force) {
        if (this._fetching) {
            // Don't drop it: the running fetch may be for outdated settings.
            this._pendingReload = {force: force || !!this._pendingReload?.force};
            return;
        }
        this._fetching = true;
        this._lastAttempt = Date.now();
        if (!this._store.hasData())
            this._label.text = '…';
        try {
            const now = new Date();
            await this._store.ensure(configFromSettings(this._settings), [now, addDays(now, 1)],
                {cancellable: this._cancellable, force});
            this._error = null;
            this._retryDelay = RETRY_MIN_SECONDS;
        } catch (e) {
            if (isCancelled(e))
                return;
            this._error = e;
            this._retryDelay = Math.min(this._retryDelay * 2, RETRY_MAX_SECONDS);
            console.warn(`[prayer-times-nil] ${e.message ?? e}`);
        } finally {
            this._fetching = false;
        }
        if (this._cancellable.is_cancelled())
            return;

        this._renderedSignature = null;
        this._tick();

        const pending = this._pendingReload;
        this._pendingReload = null;
        if (pending)
            this._reload(pending.force);
    }

    // ---- timer -----------------------------------------------------------

    // Re-arm every tick so updates land just after each wall-clock second (or minute,
    // when neither the panel nor the open menu needs seconds).
    _scheduleTick() {
        const perSecond = this.menu.isOpen || this._settings.get_boolean('show-seconds');
        const period = perSecond ? 1000 : 60 * 1000;
        const delay = period - (Date.now() % period) + 15;
        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._tickId = 0;
            this._tick();
            this._scheduleTick();
            return GLib.SOURCE_REMOVE;
        });
    }

    _restartTick() {
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
        this._tick();
        this._scheduleTick();
    }

    _tick() {
        const now = new Date();
        const s = this._strings;
        const state = computeState(this._store, now);

        // Fetch when today/tomorrow is missing (new day, new month, first run), with retry backoff.
        const needsData = !state || !this._store.getDay(addDays(now, 1));
        if (needsData && !this._fetching && Date.now() - this._lastAttempt > this._retryDelay * 1000)
            this._reload(false);

        if (!state) {
            this._label.text = this._error ? '⚠' : '…';
            this._renderEmpty();
            return;
        }

        const showSeconds = this._settings.get_boolean('show-seconds');
        const countdown = formatCountdown(state.remainingSec, showSeconds);
        this._label.text = s.panel(state.next.key, countdown, s);

        // Rebuild rows only when the day or the current/next prayer changes.
        const signature = [dayKey(now), state.nextIdx, state.next.key, this._error ? 1 : 0,
            state.tzMismatch ? 1 : 0, this._settings.get_string('language')].join('|');
        if (signature !== this._renderedSignature) {
            this._renderedSignature = signature;
            this._renderState(state, now);
        }
        if (this.menu.isOpen)
            this._countdownLabel.text = s.remaining(state.next.key, formatCountdown(state.remainingSec, true), s);
    }

    // ---- menu --------------------------------------------------------------

    _buildMenu() {
        this.menu.removeAll();
        this._renderedSignature = null;
        const s = this._strings;

        // Header: location + dates
        const header = infoItem('ptn-header');
        const headerBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this._titleLabel = new St.Label({style_class: 'ptn-title'});
        this._dateLabel = new St.Label({style_class: 'ptn-subtitle'});
        this._hijriLabel = new St.Label({style_class: 'ptn-subtitle'});
        this._dateLabel.opacity = 190;
        this._hijriLabel.opacity = 190;
        headerBox.add_child(this._titleLabel);
        headerBox.add_child(this._dateLabel);
        headerBox.add_child(this._hijriLabel);
        header.add_child(headerBox);
        this.menu.addMenuItem(header);

        // Big countdown
        const countdownItem = infoItem('ptn-countdown-item');
        this._countdownLabel = new St.Label({style_class: 'ptn-countdown', x_expand: true});
        countdownItem.add_child(this._countdownLabel);
        this.menu.addMenuItem(countdownItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Six prayer rows
        this._rows = {};
        for (const key of ['imsak', 'gunes', 'ogle', 'ikindi', 'aksam', 'yatsi']) {
            const row = infoItem('ptn-row');
            const marker = new St.Label({text: '', style_class: 'ptn-marker', y_align: Clutter.ActorAlign.CENTER});
            const name = new St.Label({text: s.names[key], x_expand: true, style_class: 'ptn-row-name', y_align: Clutter.ActorAlign.CENTER});
            const time = new St.Label({text: '--:--', style_class: 'ptn-row-time', y_align: Clutter.ActorAlign.CENTER});
            row.add_child(marker);
            row.add_child(name);
            row.add_child(time);
            this.menu.addMenuItem(row);
            this._rows[key] = {row, marker, name, time};
        }

        // Status line (errors / offline / source)
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const statusItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this._statusLabel = new St.Label({style_class: 'ptn-status', x_expand: true});
        this._statusLabel.clutter_text.line_wrap = true;
        statusItem.add_child(this._statusLabel);
        this.menu.addMenuItem(statusItem);

        // Actions
        const refresh = new PopupMenu.PopupImageMenuItem(s.refresh, 'view-refresh-symbolic');
        refresh.connect('activate', () => {
            this._error = null;
            this._reload(true);
        });
        this.menu.addMenuItem(refresh);

        const prefs = new PopupMenu.PopupImageMenuItem(s.settings, 'preferences-system-symbolic');
        prefs.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(prefs);

        this._renderEmpty();
    }

    _locationName() {
        if (this._settings.get_string('source') === 'diyanet')
            return titleCase(this._settings.get_string('diyanet-city-name'), this._strings.locale);
        return this._settings.get_string('aladhan-city-name');
    }

    _sourceText() {
        const s = this._strings;
        return this._settings.get_string('source') === 'diyanet' ? s.sourceDiyanet : s.sourceAladhan;
    }

    _renderEmpty() {
        const s = this._strings;
        this._titleLabel.text = this._locationName();
        this._dateLabel.text = new Date().toLocaleDateString(s.locale, {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'});
        this._hijriLabel.visible = false;
        this._countdownLabel.text = this._error ? s.error : s.loading;
        this._statusLabel.text = this._error ? s.errorHint : this._sourceText();
        for (const r of Object.values(this._rows)) {
            r.time.text = '--:--';
            r.marker.text = '';
            r.row.opacity = 255;
            r.row.remove_style_class_name('ptn-current');
            r.row.remove_style_class_name('ptn-next');
        }
    }

    _renderState(state, now) {
        const s = this._strings;
        const lang = this._settings.get_string('language');
        this._titleLabel.text = this._locationName();
        this._dateLabel.text = now.toLocaleDateString(s.locale, {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'});
        const hijri = hijriText(state.day.hijri, lang);
        this._hijriLabel.text = hijri;
        this._hijriLabel.visible = !!hijri;
        if (this._error)
            this._statusLabel.text = s.offline;
        else if (state.tzMismatch)
            this._statusLabel.text = s.tzMismatch;
        else
            this._statusLabel.text = this._sourceText();

        state.events.forEach((ev, idx) => {
            const r = this._rows[ev.key];
            r.time.text = ev.time;
            // Before imsak the current prayer is yesterday's yatsı; today's yatsı row
            // (still ahead) must not be highlighted as current.
            const isCurrent = ev.key === state.currentKey && state.nextIdx !== 0;
            const isNext = !state.next.tomorrow && ev.key === state.next.key;
            const isPast = state.nextIdx === -1 ? true : idx < state.nextIdx;
            r.row.opacity = isPast && !isCurrent ? PAST_OPACITY : 255;
            r.marker.text = isCurrent ? '●' : '';
            if (isCurrent)
                r.row.add_style_class_name('ptn-current');
            else
                r.row.remove_style_class_name('ptn-current');
            if (isNext)
                r.row.add_style_class_name('ptn-next');
            else
                r.row.remove_style_class_name('ptn-next');
        });
        this._countdownLabel.text = s.remaining(state.next.key, formatCountdown(state.remainingSec, true), s);
    }

    destroy() {
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
        if (this._settingsTimeoutId) {
            GLib.source_remove(this._settingsTimeoutId);
            this._settingsTimeoutId = 0;
        }
        this._cancellable.cancel();
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        if (this._networkChangedId) {
            this._networkMonitor.disconnect(this._networkChangedId);
            this._networkChangedId = 0;
        }
        this._networkMonitor = null;
        this._session.abort();
        this._settings = null;
        super.destroy();
    }
});

export default class PrayerTimesNilExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._addIndicator();
        this._positionId = this._settings.connect('changed::panel-position', () => {
            this._removeIndicator();
            this._addIndicator();
        });
    }

    disable() {
        if (this._positionId) {
            this._settings.disconnect(this._positionId);
            this._positionId = 0;
        }
        this._removeIndicator();
        this._settings = null;
    }

    _addIndicator() {
        this._indicator = new PrayerIndicator(this);
        const position = this._settings.get_string('panel-position');
        const index = position === 'right' ? 0 : -1;
        Main.panel.addToStatusArea(this.uuid, this._indicator, index, position);
    }

    _removeIndicator() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
