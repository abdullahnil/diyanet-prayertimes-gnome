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

const RETRY_SECONDS = 60;
const PAST_OPACITY = 120;

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
        this._error = null;
        this._lastAttempt = 0;
        this._renderedSignature = null;
        this._tickId = 0;

        this._label = new St.Label({
            text: '…',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'ptn-panel-label',
        });
        this.add_child(this._label);

        this.menu.box.add_style_class_name('ptn-menu');
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._tick();
        });

        this._settingsChangedId = this._settings.connect('changed', (_s, key) => this._onSettingChanged(key));

        this._buildMenu();
        this._reload(false);
        this._scheduleTick();
    }

    // ---- settings ------------------------------------------------------

    _onSettingChanged(key) {
        if (key === 'panel-position')
            return; // handled by the extension (re-adds the indicator)
        if (['language', 'show-seconds'].includes(key)) {
            this._buildMenu();
            this._tick();
            return;
        }
        if (key === 'diyanet-country-id' || key === 'diyanet-state-id')
            return; // only the city id matters for fetching
        // Location/source changed: refetch.
        this._error = null;
        this._buildMenu();
        this._reload(false);
    }

    get _strings() {
        return getStrings(this._settings.get_string('language'));
    }

    // ---- data ------------------------------------------------------------

    async _reload(force) {
        if (this._fetching)
            return;
        this._fetching = true;
        this._lastAttempt = Date.now();
        if (!this._store.hasData())
            this._label.text = '…';
        try {
            const now = new Date();
            await this._store.ensure(configFromSettings(this._settings), [now, addDays(now, 1)],
                {cancellable: this._cancellable, force});
            this._error = null;
        } catch (e) {
            if (isCancelled(e))
                return;
            this._error = e;
            console.warn(`[prayer-times-nil] ${e.message ?? e}`);
        } finally {
            this._fetching = false;
        }
        if (!this._cancellable.is_cancelled()) {
            this._renderedSignature = null;
            this._tick();
        }
    }

    // ---- timer -----------------------------------------------------------

    // Re-arm every tick so updates land just after each wall-clock second.
    _scheduleTick() {
        const delay = 1000 - (Date.now() % 1000) + 15;
        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._tickId = 0;
            this._tick();
            this._scheduleTick();
            return GLib.SOURCE_REMOVE;
        });
    }

    _tick() {
        const now = new Date();
        const s = this._strings;
        const state = computeState(this._store, now);

        // Fetch when today/tomorrow is missing (new day, new month, first run), with retry backoff.
        const needsData = !state || !this._store.getDay(addDays(now, 1));
        if (needsData && !this._fetching && Date.now() - this._lastAttempt > RETRY_SECONDS * 1000)
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
        const signature = `${dayKey(now)}|${state.currentKey}|${state.next.key}|${this._error ? 1 : 0}|${this._settings.get_string('language')}`;
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
        this._statusLabel.text = this._error ? s.offline : this._sourceText();

        state.events.forEach((ev, idx) => {
            const r = this._rows[ev.key];
            r.time.text = ev.time;
            const isCurrent = ev.key === state.currentKey;
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
        this._cancellable.cancel();
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
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
