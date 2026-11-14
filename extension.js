/* -*- mode: js2; indent-tabs-mode: nil; js2-basic-offset: 4 -*- */
'use strict';

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

async function runDdcutilAsync(args) {
    try {
        const proc = new Gio.Subprocess({
            argv: ['ddcutil', ...args],
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        proc.init(null);
        const [stdout, stderr] = await proc.communicate_utf8_async(null, null);
        const status = proc.get_exit_status();
        return { success: status === 0, stdout: stdout || '', stderr: stderr || '' };
    } catch (e) {
        return { success: false, stdout: '', stderr: String(e) };
    }
}

class DdcWorker {
    constructor(bus) {
        this._bus = bus;
        this._chain = Promise.resolve();
        this._timers = new Map();
        this._currentPreset = '01'; // Default sRGB
    }

    setBus(bus) {
        this._bus = bus;
    }

    getBus() {
        return this._bus;
    }

    setCurrentPreset(preset) {
        this._currentPreset = preset.toLowerCase().replace(/^0x/, '');
    }

    getCurrentPreset() {
        return this._currentPreset;
    }

    // Serialized execution: only one ddcutil command touches the I2C bus at a time
    _enqueue(fn) {
        this._chain = this._chain.then(async () => {
            try {
                return await fn();
            } catch (err) {
                console.error(`[ExternalMonitorControl] DDC worker error: ${err}`);
            }
        });
        return this._chain;
    }

    execute(args) {
        return this._enqueue(() => runDdcutilAsync(args));
    }

    setVcpContinuous(featureHex, val, onPresetUnlocked = null, delayMs = 120) {
        if (this._timers.has(featureHex)) {
            GLib.source_remove(this._timers.get(featureHex));
            this._timers.delete(featureHex);
        }

        const timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
            this._timers.delete(featureHex);

            this._enqueue(async () => {
                // When in sRGB (01), the monitor firmware locks Contrast (12) and RGB Gain (16, 18, 1a).
                // Automatically switch to User 1 (0b) so the hardware unlocks and applies the change.
                const isColorAdjustment = ['12', '16', '18', '1a'].includes(featureHex.toLowerCase());
                if (isColorAdjustment && this._currentPreset === '01') {
                    console.log('[ExternalMonitorControl] sRGB preset active: unlocking monitor into User 1 custom mode.');
                    this._currentPreset = '0b';
                    if (onPresetUnlocked) {
                        onPresetUnlocked('0b');
                    }
                    await runDdcutilAsync([
                        '--bus', String(this._bus),
                        '--noverify',
                        'setvcp', '14', '0x0b'
                    ]);
                    // Settle pause for monitor EEPROM/matrix transition
                    await new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => { r(); return GLib.SOURCE_REMOVE; }));
                }

                return await runDdcutilAsync([
                    '--bus', String(this._bus),
                    '--noverify',
                    'setvcp', featureHex, String(val)
                ]);
            });

            return GLib.SOURCE_REMOVE;
        });

        this._timers.set(featureHex, timerId);
    }

    setVcpImmediate(featureHex, val) {
        if (this._timers.has(featureHex)) {
            GLib.source_remove(this._timers.get(featureHex));
            this._timers.delete(featureHex);
        }

        return this._enqueue(async () => {
            return await runDdcutilAsync([
                '--bus', String(this._bus),
                '--noverify',
                'setvcp', featureHex, String(val)
            ]);
        });
    }

    destroy() {
        for (const [_, id] of this._timers) {
            GLib.source_remove(id);
        }
        this._timers.clear();
    }
}

const SliderMenuItem = GObject.registerClass(
class SliderMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(iconName, labelText, initialPercent, onValueChanged) {
        super._init({ activate: false, reactive: true });

        this._onValueChanged = onValueChanged;
        this._isInternalUpdate = false;

        const box = new St.BoxLayout({
            style_class: 'emc-slider-row',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        if (iconName) {
            const icon = new St.Icon({
                icon_name: iconName,
                style_class: 'emc-icon popup-menu-icon',
                y_align: Clutter.ActorAlign.CENTER,
            });
            box.add_child(icon);
        }

        const label = new St.Label({
            text: labelText,
            style_class: 'emc-slider-label popup-menu-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(label);

        this._slider = new Slider.Slider(initialPercent / 100);
        this._slider.x_expand = true;
        this._slider.y_align = Clutter.ActorAlign.CENTER;
        box.add_child(this._slider);

        this._valueLabel = new St.Label({
            text: `${Math.round(initialPercent)}%`,
            style_class: 'emc-slider-value',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._valueLabel);

        this.add_child(box);

        this._slider.connect('notify::value', () => {
            const pct = Math.round(this._slider.value * 100);
            this._valueLabel.set_text(`${pct}%`);
            if (!this._isInternalUpdate && this._onValueChanged) {
                this._onValueChanged(pct);
            }
        });
    }

    setValue(pct) {
        this._isInternalUpdate = true;
        this._slider.value = Math.min(100, Math.max(0, pct)) / 100;
        this._valueLabel.set_text(`${Math.round(pct)}%`);
        this._isInternalUpdate = false;
    }

    getValue() {
        return Math.round(this._slider.value * 100);
    }
});

const MonitorControlIndicator = GObject.registerClass(
class MonitorControlIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.5, 'External Monitor Control', false);
        this._extension = extension;
        this._bus = 7; // Default bus for Lenovo L24-4C on HDMI
        this._monitorName = 'Lenovo L24-4C';
        this._worker = new DdcWorker(this._bus);
        this._isLoading = false;

        // Top bar icon
        this._icon = new St.Icon({
            icon_name: 'video-display-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        this._buildMenu();

        // Refresh whenever menu is opened
        this.menu.connect('open-state-changed', (menu, isOpen) => {
            if (isOpen) {
                this._refreshValues();
            }
        });

        // Initial detection and values read
        this._detectMonitorAndRefresh();
    }

    _buildMenu() {
        this.menu.box.add_style_class_name('emc-menu-box');

        // Header Section: Monitor Name + Refresh
        const headerItem = new PopupMenu.PopupBaseMenuItem({ activate: false, reactive: false });
        const headerBox = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        
        const textCol = new St.BoxLayout({ vertical: true, x_expand: true });
        this._headerTitle = new St.Label({
            text: this._monitorName,
            style_class: 'emc-header-label',
        });
        this._headerSub = new St.Label({
            text: `HDMI (Bus ${this._bus})`,
            style_class: 'emc-status-subtext',
        });
        textCol.add_child(this._headerTitle);
        textCol.add_child(this._headerSub);
        headerBox.add_child(textCol);

        const refreshBtn = new St.Button({
            child: new St.Icon({ icon_name: 'view-refresh-symbolic', style_class: 'emc-icon' }),
            style_class: 'button',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        refreshBtn.connect('clicked', () => this._refreshValues());
        headerBox.add_child(refreshBtn);

        headerItem.add_child(headerBox);
        this.menu.addMenuItem(headerItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 1. Brightness Slider (VCP 0x10)
        this._brightnessItem = new SliderMenuItem(
            'display-brightness-symbolic',
            'Brightness',
            100,
            (val) => this._worker.setVcpContinuous('10', val)
        );
        this.menu.addMenuItem(this._brightnessItem);

        // 2. Contrast Slider (VCP 0x12)
        this._contrastItem = new SliderMenuItem(
            'weather-clear-symbolic',
            'Contrast',
            75,
            (val) => this._worker.setVcpContinuous('12', val, (unlocked) => this._selectPreset(unlocked))
        );
        this.menu.addMenuItem(this._contrastItem);

        // 3. Audio Volume Slider (VCP 0x62)
        this._volumeItem = new SliderMenuItem(
            'audio-volume-high-symbolic',
            'Volume',
            100,
            (val) => this._worker.setVcpContinuous('62', val)
        );
        this.menu.addMenuItem(this._volumeItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 4. Color Presets Submenu (VCP 0x14)
        this._presetSubMenu = new PopupMenu.PopupSubMenuMenuItem('Color Preset');
        this._presetItems = new Map();

        const presets = [
            { code: '01', label: 'sRGB (Factory Lock)' },
            { code: '05', label: 'Warm (6500 K)' },
            { code: '06', label: 'Neutral (7500 K)' },
            { code: '08', label: 'Cool (9300 K)' },
            { code: '0b', label: 'Custom (User 1 - Unlocked)' },
        ];

        for (const p of presets) {
            const item = new PopupMenu.PopupMenuItem(p.label);
            item.connect('activate', () => {
                this._selectPreset(p.code);
                this._worker.setCurrentPreset(p.code);
                this._worker.setVcpImmediate('14', `0x${p.code}`);
            });
            this._presetSubMenu.menu.addMenuItem(item);
            this._presetItems.set(p.code.toLowerCase(), item);
        }
        this.menu.addMenuItem(this._presetSubMenu);

        // 5. RGB Gain Submenu (VCP 0x16, 0x18, 0x1A)
        this._rgbSubMenu = new PopupMenu.PopupSubMenuMenuItem('RGB Gain (Color Balance)');
        
        this._redItem = new SliderMenuItem(
            'media-record-symbolic',
            'Red',
            100,
            (val) => this._worker.setVcpContinuous('16', val, (unlocked) => this._selectPreset(unlocked))
        );
        this._rgbSubMenu.menu.addMenuItem(this._redItem);

        this._greenItem = new SliderMenuItem(
            'media-record-symbolic',
            'Green',
            100,
            (val) => this._worker.setVcpContinuous('18', val, (unlocked) => this._selectPreset(unlocked))
        );
        this._rgbSubMenu.menu.addMenuItem(this._greenItem);

        this._blueItem = new SliderMenuItem(
            'media-record-symbolic',
            'Blue',
            100,
            (val) => this._worker.setVcpContinuous('1a', val, (unlocked) => this._selectPreset(unlocked))
        );
        this._rgbSubMenu.menu.addMenuItem(this._blueItem);

        this.menu.addMenuItem(this._rgbSubMenu);

        // 6. Input Source Submenu (VCP 0x60)
        this._inputSubMenu = new PopupMenu.PopupSubMenuMenuItem('Input Source');
        this._inputItems = new Map();
        const inputs = [
            { code: '11', label: 'HDMI-1' },
            { code: '41', label: 'Alternate / Type-C' },
        ];
        for (const inp of inputs) {
            const item = new PopupMenu.PopupMenuItem(inp.label);
            item.connect('activate', () => {
                this._selectInput(inp.code);
                this._worker.setVcpImmediate('60', `0x${inp.code}`);
            });
            this._inputSubMenu.menu.addMenuItem(item);
            this._inputItems.set(inp.code.toLowerCase(), item);
        }
        this.menu.addMenuItem(this._inputSubMenu);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 7. Monitor Power Control (VCP 0xD6)
        this._powerSubMenu = new PopupMenu.PopupSubMenuMenuItem('Display Power');
        const standbyItem = new PopupMenu.PopupMenuItem('Turn Off Screen (Standby)');
        standbyItem.connect('activate', () => {
            this._worker.setVcpImmediate('d6', '0x04');
        });
        this._powerSubMenu.menu.addMenuItem(standbyItem);

        const powerOnItem = new PopupMenu.PopupMenuItem('Wake Screen (Power On)');
        powerOnItem.connect('activate', () => {
            this._worker.setVcpImmediate('d6', '0x01');
        });
        this._powerSubMenu.menu.addMenuItem(powerOnItem);

        this.menu.addMenuItem(this._powerSubMenu);
    }

    _selectPreset(code) {
        const normCode = code.toLowerCase().replace(/^0x/, '');
        for (const [c, item] of this._presetItems) {
            if (c === normCode) {
                item.setOrnament(PopupMenu.Ornament.CHECK);
            } else {
                item.setOrnament(PopupMenu.Ornament.NONE);
            }
        }
    }

    _selectInput(code) {
        const normCode = code.toLowerCase().replace(/^0x/, '');
        for (const [c, item] of this._inputItems) {
            if (c === normCode) {
                item.setOrnament(PopupMenu.Ornament.CHECK);
            } else {
                item.setOrnament(PopupMenu.Ornament.NONE);
            }
        }
    }

    async _detectMonitorAndRefresh() {
        const res = await this._worker.execute(['detect', '--brief']);
        if (res && res.success && res.stdout) {
            // Find bus for external display (skip internal eDP-1)
            const blocks = res.stdout.split(/(?=Display \d+)/);
            for (const b of blocks) {
                if (b.includes('Display') && !b.includes('eDP-1')) {
                    const busMatch = b.match(/I2C bus:\s+\/dev\/i2c-(\d+)/);
                    const monMatch = b.match(/Monitor:\s+LEN:([A-Za-z0-9\-]+)/);
                    if (busMatch) {
                        this._bus = parseInt(busMatch[1], 10);
                        this._worker.setBus(this._bus);
                    }
                    if (monMatch) {
                        this._monitorName = `Lenovo ${monMatch[1]}`;
                    }
                    this._headerTitle.set_text(this._monitorName);
                    this._headerSub.set_text(`HDMI (Bus ${this._bus})`);
                    break;
                }
            }
        }
        await this._refreshValues();
    }

    async _refreshValues() {
        if (this._isLoading) return;
        this._isLoading = true;

        try {
            // Query all features in a single fast serialized call
            const res = await this._worker.execute([
                '--bus', String(this._bus),
                'getvcp', '10', '12', '14', '16', '18', '1A', '60', '62', 'D6'
            ]);

            if (res && res.success && res.stdout) {
                const lines = res.stdout.split('\n');
                for (const line of lines) {
                    // Continuous features: current value = X, max value = Y
                    const contMatch = line.match(/VCP code 0x([0-9a-fA-F]+).*?current value =\s*(\d+)/);
                    if (contMatch) {
                        const code = contMatch[1].toLowerCase();
                        const val = parseInt(contMatch[2], 10);
                        switch (code) {
                            case '10': // Brightness
                                this._brightnessItem.setValue(val);
                                break;
                            case '12': // Contrast
                                this._contrastItem.setValue(val);
                                break;
                            case '62': // Volume
                                this._volumeItem.setValue(val);
                                break;
                            case '16': // Red
                                this._redItem.setValue(val);
                                break;
                            case '18': // Green
                                this._greenItem.setValue(val);
                                break;
                            case '1a': // Blue
                                this._blueItem.setValue(val);
                                break;
                        }
                    }

                    // Discrete features: (sl=0xXX)
                    const discMatch = line.match(/VCP code 0x([0-9a-fA-F]+).*?\(sl=0x([0-9a-fA-F]+)\)/);
                    if (discMatch) {
                        const code = discMatch[1].toLowerCase();
                        const sl = discMatch[2].toLowerCase();
                        if (code === '14') {
                            this._selectPreset(sl);
                            this._worker.setCurrentPreset(sl);
                        } else if (code === '60') {
                            this._selectInput(sl);
                        }
                    }
                }
            }
        } catch (e) {
            console.error(`[ExternalMonitorControl] Failed to refresh values: ${e}`);
        } finally {
            this._isLoading = false;
        }
    }

    destroy() {
        if (this._worker) {
            this._worker.destroy();
            this._worker = null;
        }
        super.destroy();
    }
});

export default class ExternalMonitorControlExtension extends Extension {
    enable() {
        this._indicator = new MonitorControlIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
