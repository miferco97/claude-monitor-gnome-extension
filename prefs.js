import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ClaudeMonitorPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        this._buildGeneralPage(window, settings);
        this._buildAppearancePage(window, settings);
        this._buildAdvancedPage(window, settings);
    }

    // ── Page 1: General ───────────────────────────────────────────────

    _buildGeneralPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        // -- Subscription Plan group --
        const planGroup = new Adw.PreferencesGroup({
            title: 'Subscription Plan',
            description: 'Select your Claude plan to show usage percentages.',
        });
        page.add(planGroup);

        const planRow = new Adw.ComboRow({
            title: 'Plan Type',
            subtitle: 'Determines token and cost limits for the usage bar.',
        });
        const planModel = Gtk.StringList.new([
            'Pro ($20/mo \u2014 19k tokens, $18/5h)',
            'Max 5x ($100/mo \u2014 88k tokens, $35/5h)',
            'Max 20x ($200/mo \u2014 220k tokens, $140/5h)',
        ]);
        planRow.set_model(planModel);
        const planKeys = ['pro', 'max5', 'max20'];
        planRow.set_selected(Math.max(0, planKeys.indexOf(settings.get_string('plan-type'))));
        planRow.connect('notify::selected', () => {
            settings.set_string('plan-type', planKeys[planRow.get_selected()]);
        });
        planGroup.add(planRow);

        const estRow = new Adw.ComboRow({
            title: 'Estimation Mode',
            subtitle: 'How aggressively to estimate usage vs /usage.',
        });
        const estModel = Gtk.StringList.new([
            'Conservative (raw calculation)',
            'Balanced (approximate /usage)',
            'Generous (safety margin)',
        ]);
        estRow.set_model(estModel);
        const estKeys = ['conservative', 'balanced', 'generous'];
        estRow.set_selected(Math.max(0, estKeys.indexOf(settings.get_string('estimation-mode'))));
        estRow.connect('notify::selected', () => {
            settings.set_string('estimation-mode', estKeys[estRow.get_selected()]);
        });
        planGroup.add(estRow);

        // -- Data Source Mode --
        const dsRow = new Adw.ComboRow({
            title: 'Data Source Mode',
            subtitle: 'How to combine API and heuristic data.',
        });
        const dsModel = Gtk.StringList.new([
            'Hybrid (API anchor + live heuristic delta)',
            'API only (update on each API fetch)',
        ]);
        dsRow.set_model(dsModel);
        const dsKeys = ['hybrid', 'api-only'];
        dsRow.set_selected(Math.max(0, dsKeys.indexOf(settings.get_string('data-source-mode'))));
        dsRow.connect('notify::selected', () => {
            settings.set_string('data-source-mode', dsKeys[dsRow.get_selected()]);
        });
        planGroup.add(dsRow);

        // -- API Fetch Interval --
        const apiFetchRow = new Adw.SpinRow({
            title: 'API Fetch Interval',
            subtitle: 'How often to call the Anthropic API (seconds, min 10).',
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 3600,
                step_increment: 30,
                value: settings.get_int('api-fetch-interval'),
            }),
        });
        apiFetchRow.connect('notify::value', () => {
            settings.set_int('api-fetch-interval', apiFetchRow.get_value());
        });
        planGroup.add(apiFetchRow);

        // -- Show API update time --
        const apiTimeRow = new Adw.SwitchRow({
            title: 'Show API Update Time',
            subtitle: 'Display how long ago the last API fetch was.',
        });
        apiTimeRow.set_active(settings.get_boolean('show-api-update-time'));
        apiTimeRow.connect('notify::active', () => {
            settings.set_boolean('show-api-update-time', apiTimeRow.get_active());
        });
        planGroup.add(apiTimeRow);

        // -- Bar Metric --
        const metricGroup = new Adw.PreferencesGroup({
            title: 'Metric',
        });
        page.add(metricGroup);

        const metricRow = new Adw.ComboRow({
            title: 'Bar Metric',
            subtitle: 'What the progress bar represents.',
        });
        const metricModel = Gtk.StringList.new(['Cost ($)', 'Tokens']);
        metricRow.set_model(metricModel);
        const metricKeys = ['cost', 'tokens'];
        metricRow.set_selected(Math.max(0, metricKeys.indexOf(settings.get_string('bar-metric'))));
        metricRow.connect('notify::selected', () => {
            settings.set_string('bar-metric', metricKeys[metricRow.get_selected()]);
        });
        metricGroup.add(metricRow);

        // -- General group --
        const generalGroup = new Adw.PreferencesGroup({
            title: 'General',
        });
        page.add(generalGroup);

        const refreshRow = new Adw.SpinRow({
            title: 'Refresh Interval',
            subtitle: 'How often to re-read data files (seconds).',
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 120,
                step_increment: 5,
                value: settings.get_int('refresh-interval'),
            }),
        });
        refreshRow.connect('notify::value', () => {
            settings.set_int('refresh-interval', refreshRow.get_value());
        });
        generalGroup.add(refreshRow);

        const posRow = new Adw.ComboRow({
            title: 'Panel Position',
            subtitle: 'Which side of the top bar to place the indicator.',
        });
        const posModel = Gtk.StringList.new(['Right', 'Left']);
        posRow.set_model(posModel);
        posRow.set_selected(settings.get_string('panel-position') === 'left' ? 1 : 0);
        posRow.connect('notify::selected', () => {
            settings.set_string('panel-position', posRow.get_selected() === 1 ? 'left' : 'right');
        });
        generalGroup.add(posRow);
    }

    // ── Page 2: Appearance ────────────────────────────────────────────

    _buildAppearancePage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: 'Appearance',
            icon_name: 'applications-graphics-symbolic',
        });
        window.add(page);

        // -- Panel Elements (individual toggles) --
        const elementsGroup = new Adw.PreferencesGroup({
            title: 'Panel Elements',
            description: 'Toggle what to show in the panel indicator. Mix and match freely.',
        });
        page.add(elementsGroup);

        const iconRow = new Adw.SwitchRow({
            title: 'Show Icon',
            subtitle: 'Claude icon or symbolic icon in the panel.',
        });
        settings.bind('show-icon', iconRow, 'active', 0);
        elementsGroup.add(iconRow);

        const barRow = new Adw.SwitchRow({
            title: 'Show Bar',
            subtitle: 'Progress bar showing usage against plan limit.',
        });
        settings.bind('show-bar', barRow, 'active', 0);
        elementsGroup.add(barRow);

        const pctRow = new Adw.SwitchRow({
            title: 'Show Percentage',
            subtitle: 'Usage percentage text (e.g., 70%).',
        });
        settings.bind('show-percentage', pctRow, 'active', 0);
        elementsGroup.add(pctRow);

        const timeRow = new Adw.SwitchRow({
            title: 'Show Time',
            subtitle: 'Time remaining or reset countdown.',
        });
        settings.bind('show-time', timeRow, 'active', 0);
        elementsGroup.add(timeRow);

        const dotRow = new Adw.SwitchRow({
            title: 'Show Status Dot',
            subtitle: 'Colored dot indicating usage level (green/yellow/red).',
        });
        settings.bind('show-status-dot', dotRow, 'active', 0);
        elementsGroup.add(dotRow);

        const badgeRow = new Adw.SwitchRow({
            title: 'Show Status Badge',
            subtitle: 'Small colored dot overlay on the icon corner.',
        });
        settings.bind('show-status-badge', badgeRow, 'active', 0);
        elementsGroup.add(badgeRow);

        // -- Time Display --
        const timeGroup = new Adw.PreferencesGroup({
            title: 'Time Display',
        });
        page.add(timeGroup);

        const timeDisplayRow = new Adw.ComboRow({
            title: 'Time Display',
            subtitle: 'What time info to show when "Show Time" is enabled.',
        });
        const timeModel = Gtk.StringList.new([
            'None',
            'Estimated time remaining',
            'Reset countdown',
        ]);
        timeDisplayRow.set_model(timeModel);
        const timeKeys = ['none', 'remaining', 'reset'];
        timeDisplayRow.set_selected(
            Math.max(0, timeKeys.indexOf(settings.get_string('time-display')))
        );
        timeDisplayRow.connect('notify::selected', () => {
            settings.set_string('time-display', timeKeys[timeDisplayRow.get_selected()]);
        });
        timeGroup.add(timeDisplayRow);

        // -- Prefix group --
        const prefixGroup = new Adw.PreferencesGroup({
            title: 'Prefix',
        });
        page.add(prefixGroup);

        const prefixToggleRow = new Adw.SwitchRow({
            title: 'Show Claude Prefix',
            subtitle: 'Display a label or icon before the bar.',
        });
        settings.bind('show-prefix', prefixToggleRow, 'active', 0);
        prefixGroup.add(prefixToggleRow);

        const prefixStyleRow = new Adw.ComboRow({
            title: 'Prefix Style',
            subtitle: 'Show the word "Claude", the Claude icon, or a symbolic icon.',
        });
        const prefixStyleModel = Gtk.StringList.new(['Text', 'Icon', 'Symbolic Icon']);
        prefixStyleRow.set_model(prefixStyleModel);
        const prefixStyleKeys = ['text', 'icon', 'symbolic'];
        prefixStyleRow.set_selected(
            Math.max(0, prefixStyleKeys.indexOf(settings.get_string('prefix-style')))
        );
        prefixStyleRow.connect('notify::selected', () => {
            settings.set_string('prefix-style', prefixStyleKeys[prefixStyleRow.get_selected()]);
        });
        prefixGroup.add(prefixStyleRow);

        // -- Progress Bar group --
        const barGroup = new Adw.PreferencesGroup({
            title: 'Progress Bar',
        });
        page.add(barGroup);

        const barStyleRow = new Adw.ComboRow({
            title: 'Bar Style',
            subtitle: 'Visual style for the progress bar. Middle-click to cycle.',
        });
        const barStyleModel = Gtk.StringList.new([
            'Blocks  \u2588\u2588\u2588\u2591\u2591',
            'Smooth  \u2588\u2588\u258C\u2591\u2591',
            'Dots  \u25CF\u25CF\u25CF\u25CB\u25CB',
            'Squares  \u25A0\u25A0\u25A0\u25A1\u25A1',
            'Thin  \u25B0\u25B0\u25B0\u25B1\u25B1',
            'Pill \u2014 rounded Cairo bar',
            'Thick Rounded \u2014 glow effect',
            'Segmented \u2014 discrete segments',
            'Glow Edge \u2014 glowing leading edge',
            'Vertical Bar \u2014 ultra-compact',
            'Vertical Dual \u2014 cost + tokens',
        ]);
        barStyleRow.set_model(barStyleModel);
        const barStyleKeys = [
            'blocks', 'smooth', 'dots', 'squares', 'thin',
            'pill', 'thick-rounded', 'segmented', 'glow-edge',
            'vbar', 'vbar-dual',
        ];
        barStyleRow.set_selected(
            Math.max(0, barStyleKeys.indexOf(settings.get_string('bar-style')))
        );
        barStyleRow.connect('notify::selected', () => {
            settings.set_string('bar-style', barStyleKeys[barStyleRow.get_selected()]);
        });
        barGroup.add(barStyleRow);

        const barLengthRow = new Adw.SpinRow({
            title: 'Bar Length',
            subtitle: 'Number of segments in the progress bar.',
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 30,
                step_increment: 1,
                value: settings.get_int('bar-length'),
            }),
        });
        barLengthRow.connect('notify::value', () => {
            settings.set_int('bar-length', barLengthRow.get_value());
        });
        barGroup.add(barLengthRow);

        const colorRow = new Adw.ComboRow({
            title: 'Bar Color',
            subtitle: 'Color scheme for the progress bar.',
        });
        const colorModel = Gtk.StringList.new([
            'White',
            'Green \u2192 Red',
            'Blue',
            'Purple',
            'Amber',
            'Rainbow',
            'Dracula \u2014 purple \u2192 pink',
            'Nord \u2014 blue \u2192 cyan',
            'Catppuccin \u2014 mauve \u2192 peach \u2192 green',
            'Neon \u2014 cyan \u2192 magenta \u2192 green',
            'Sunset \u2014 orange \u2192 red \u2192 purple',
            'Ocean \u2014 deep blue \u2192 teal \u2192 cyan',
            'Solarized \u2014 warm yellow-orange',
            'Accent \u2014 system accent color',
            'Custom \u2014 user-defined gradient',
        ]);
        colorRow.set_model(colorModel);
        const colorKeys = [
            'white', 'green-red', 'blue', 'purple', 'amber', 'rainbow',
            'dracula', 'nord', 'catppuccin', 'neon', 'sunset', 'ocean', 'solarized',
            'accent', 'custom',
        ];
        colorRow.set_selected(
            Math.max(0, colorKeys.indexOf(settings.get_string('bar-color')))
        );
        colorRow.connect('notify::selected', () => {
            settings.set_string('bar-color', colorKeys[colorRow.get_selected()]);
            customStartRow.set_sensitive(colorKeys[colorRow.get_selected()] === 'custom');
            customEndRow.set_sensitive(colorKeys[colorRow.get_selected()] === 'custom');
        });
        barGroup.add(colorRow);

        // Custom color pickers
        const customStartRow = new Adw.ActionRow({
            title: 'Gradient Start Color',
            subtitle: 'Start of the custom gradient.',
        });
        const startBtn = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog(),
        });
        const startRgba = new Gdk.RGBA();
        startRgba.parse(settings.get_string('custom-color-start'));
        startBtn.set_rgba(startRgba);
        startBtn.connect('notify::rgba', () => {
            const rgba = startBtn.get_rgba();
            const hex = '#' +
                Math.round(rgba.red * 255).toString(16).padStart(2, '0') +
                Math.round(rgba.green * 255).toString(16).padStart(2, '0') +
                Math.round(rgba.blue * 255).toString(16).padStart(2, '0');
            settings.set_string('custom-color-start', hex);
        });
        customStartRow.add_suffix(startBtn);
        customStartRow.set_sensitive(settings.get_string('bar-color') === 'custom');
        barGroup.add(customStartRow);

        const customEndRow = new Adw.ActionRow({
            title: 'Gradient End Color',
            subtitle: 'End of the custom gradient.',
        });
        const endBtn = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog(),
        });
        const endRgba = new Gdk.RGBA();
        endRgba.parse(settings.get_string('custom-color-end'));
        endBtn.set_rgba(endRgba);
        endBtn.connect('notify::rgba', () => {
            const rgba = endBtn.get_rgba();
            const hex = '#' +
                Math.round(rgba.red * 255).toString(16).padStart(2, '0') +
                Math.round(rgba.green * 255).toString(16).padStart(2, '0') +
                Math.round(rgba.blue * 255).toString(16).padStart(2, '0');
            settings.set_string('custom-color-end', hex);
        });
        customEndRow.add_suffix(endBtn);
        customEndRow.set_sensitive(settings.get_string('bar-color') === 'custom');
        barGroup.add(customEndRow);

        // -- Panel Style group --
        const panelGroup = new Adw.PreferencesGroup({
            title: 'Panel Style',
        });
        page.add(panelGroup);

        const pillRow = new Adw.ComboRow({
            title: 'Pill Background',
            subtitle: 'Background style for the panel button.',
        });
        const pillModel = Gtk.StringList.new([
            'Off \u2014 transparent',
            'Solid \u2014 visible pill with fill + border',
            'Subtle \u2014 semi-transparent background',
            'Border Only \u2014 outline, no fill',
            'Status \u2014 color changes with usage',
            'Glow \u2014 purple neon glow',
        ]);
        pillRow.set_model(pillModel);
        const pillKeys = ['off', 'solid', 'subtle', 'border-only', 'status', 'glow'];
        pillRow.set_selected(Math.max(0, pillKeys.indexOf(settings.get_string('pill-background'))));
        pillRow.connect('notify::selected', () => {
            settings.set_string('pill-background', pillKeys[pillRow.get_selected()]);
        });
        panelGroup.add(pillRow);

        // -- Dropdown Style group --
        const dropdownGroup = new Adw.PreferencesGroup({
            title: 'Dropdown Menu',
        });
        page.add(dropdownGroup);

        const dropdownRow = new Adw.ComboRow({
            title: 'Dropdown Style',
            subtitle: 'Style for the click-to-expand menu.',
        });
        const dropdownModel = Gtk.StringList.new([
            'Classic \u2014 simple text rows',
            'Modern \u2014 progress bar, colored dots, sparkline',
            'Gauges \u2014 circular arc gauges',
        ]);
        dropdownRow.set_model(dropdownModel);
        const dropdownKeys = ['classic', 'modern', 'gauges'];
        dropdownRow.set_selected(Math.max(0, dropdownKeys.indexOf(settings.get_string('dropdown-style'))));
        dropdownRow.connect('notify::selected', () => {
            settings.set_string('dropdown-style', dropdownKeys[dropdownRow.get_selected()]);
        });
        dropdownGroup.add(dropdownRow);
    }

    // ── Page 3: Advanced ──────────────────────────────────────────────

    _buildAdvancedPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: 'Advanced',
            icon_name: 'preferences-other-symbolic',
        });
        window.add(page);

        // -- Typography group --
        const typoGroup = new Adw.PreferencesGroup({
            title: 'Typography',
            description: 'Font size and text effects for the panel indicator.',
        });
        page.add(typoGroup);

        const fontSizeRow = new Adw.ComboRow({
            title: 'Font Size',
            subtitle: 'Size of the panel indicator text.',
        });
        const fontSizeModel = Gtk.StringList.new([
            'Small (10px)',
            'Medium (12px)',
            'Large (14px)',
        ]);
        fontSizeRow.set_model(fontSizeModel);
        const fontSizeKeys = ['small', 'medium', 'large'];
        fontSizeRow.set_selected(
            Math.max(0, fontSizeKeys.indexOf(settings.get_string('font-size')))
        );
        fontSizeRow.connect('notify::selected', () => {
            settings.set_string('font-size', fontSizeKeys[fontSizeRow.get_selected()]);
        });
        typoGroup.add(fontSizeRow);

        const textEffectRow = new Adw.ComboRow({
            title: 'Text Effect',
            subtitle: 'Visual effect applied to panel text.',
        });
        const textEffectModel = Gtk.StringList.new([
            'None',
            'Glow \u2014 bright vivid color',
            'Shadow \u2014 dimmer muted text',
        ]);
        textEffectRow.set_model(textEffectModel);
        const textEffectKeys = ['none', 'glow', 'shadow'];
        textEffectRow.set_selected(
            Math.max(0, textEffectKeys.indexOf(settings.get_string('text-effect')))
        );
        textEffectRow.connect('notify::selected', () => {
            settings.set_string('text-effect', textEffectKeys[textEffectRow.get_selected()]);
        });
        typoGroup.add(textEffectRow);

        // -- Pulse Animation group --
        const pulseGroup = new Adw.PreferencesGroup({
            title: 'Pulse Animation',
            description: 'Flicker effect at high usage levels.',
        });
        page.add(pulseGroup);

        const pulseRow = new Adw.SwitchRow({
            title: 'Enable Pulse',
            subtitle: 'Pulse the indicator when usage exceeds threshold.',
        });
        settings.bind('enable-pulse', pulseRow, 'active', 0);
        pulseGroup.add(pulseRow);

        const thresholdRow = new Adw.SpinRow({
            title: 'Pulse Threshold (%)',
            subtitle: 'Usage percentage at which pulsing begins.',
            adjustment: new Gtk.Adjustment({
                lower: 50,
                upper: 100,
                step_increment: 5,
                value: settings.get_int('pulse-threshold'),
            }),
        });
        thresholdRow.connect('notify::value', () => {
            settings.set_int('pulse-threshold', thresholdRow.get_value());
        });
        pulseGroup.add(thresholdRow);

        // -- Element Order group --
        const orderGroup = new Adw.PreferencesGroup({
            title: 'Element Order',
            description: 'Arrange elements left-to-right in the panel indicator.',
        });
        page.add(orderGroup);

        const elementLabels = {
            icon: 'Icon',
            label: 'Label (text/percentage/time)',
            bar: 'Progress Bar',
            dot: 'Status Dot',
        };
        const orderKeys = ['icon', 'label', 'bar', 'dot'];

        // Create a combo row for each position (1st, 2nd, 3rd, 4th)
        const positionNames = ['1st', '2nd', '3rd', '4th'];
        const positionRows = [];

        const getCurrentOrder = () => {
            return settings.get_string('element-order').split(',').map(s => s.trim()).filter(Boolean);
        };

        const updateOrderSetting = () => {
            const order = positionRows.map(row => orderKeys[row.get_selected()]);
            // Check for duplicates — only save if all unique
            if (new Set(order).size === order.length) {
                settings.set_string('element-order', order.join(','));
            }
        };

        const currentOrder = getCurrentOrder();
        for (let i = 0; i < 4; i++) {
            const row = new Adw.ComboRow({
                title: `Position ${positionNames[i]}`,
            });
            const model = Gtk.StringList.new(orderKeys.map(k => elementLabels[k]));
            row.set_model(model);

            const elem = currentOrder[i] || orderKeys[i];
            row.set_selected(Math.max(0, orderKeys.indexOf(elem)));

            row.connect('notify::selected', updateOrderSetting);
            orderGroup.add(row);
            positionRows.push(row);
        }
    }
}
