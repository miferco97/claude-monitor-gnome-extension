const Adw = imports.gi.Adw;
const Gtk = imports.gi.Gtk;
const Gdk = imports.gi.Gdk;
const ExtensionUtils = imports.misc.extensionUtils;

function init() {}

function buildPrefsWidget() {
    const settings = ExtensionUtils.getSettings();

    const notebook = new Gtk.Notebook();

    notebook.append_page(
        _buildGeneralPage(settings),
        new Gtk.Label({ label: 'General' })
    );
    notebook.append_page(
        _buildAppearancePage(settings),
        new Gtk.Label({ label: 'Appearance' })
    );
    notebook.append_page(
        _buildAdvancedPage(settings),
        new Gtk.Label({ label: 'Advanced' })
    );

    notebook.show();
    return notebook;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _makeSwitchRow(title, subtitle, settings, key) {
    const sw = new Gtk.Switch({ valign: Gtk.Align.CENTER });
    settings.bind(key, sw, 'active', 0);
    const row = new Adw.ActionRow({ title, subtitle });
    row.add_suffix(sw);
    row.set_activatable_widget(sw);
    return row;
}

function _makeSpinRow(title, subtitle, settings, key, lower, upper, step) {
    const adj = new Gtk.Adjustment({ lower, upper, step_increment: step, value: settings.get_int(key) });
    const spin = new Gtk.SpinButton({ adjustment: adj, valign: Gtk.Align.CENTER });
    spin.connect('value-changed', () => settings.set_int(key, spin.get_value_as_int()));
    const row = new Adw.ActionRow({ title, subtitle });
    row.add_suffix(spin);
    row.set_activatable_widget(spin);
    return row;
}

function _makeComboRow(title, subtitle, labels, keys, settings, key) {
    const row = new Adw.ComboRow({ title, subtitle });
    row.set_model(Gtk.StringList.new(labels));
    row.set_selected(Math.max(0, keys.indexOf(settings.get_string(key))));
    row.connect('notify::selected', () => settings.set_string(key, keys[row.get_selected()]));
    return row;
}

// ── Page 1: General ───────────────────────────────────────────────────────────

function _buildGeneralPage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'General',
        icon_name: 'preferences-system-symbolic',
    });

    const planGroup = new Adw.PreferencesGroup({
        title: 'Subscription Plan',
        description: 'Select your Claude plan to show usage percentages.',
    });
    page.add(planGroup);
    planGroup.add(_makeComboRow(
        'Plan Type',
        'Determines token and cost limits for the usage bar.',
        [
            'Pro ($20/mo \u2014 19k tokens, $18/5h)',
            'Max 5x ($100/mo \u2014 88k tokens, $35/5h)',
            'Max 20x ($200/mo \u2014 220k tokens, $140/5h)',
        ],
        ['pro', 'max5', 'max20'],
        settings, 'plan-type'
    ));
    planGroup.add(_makeComboRow(
        'Estimation Mode',
        'How aggressively to estimate usage vs /usage.',
        [
            'Conservative (raw calculation)',
            'Balanced (approximate /usage)',
            'Generous (safety margin)',
        ],
        ['conservative', 'balanced', 'generous'],
        settings, 'estimation-mode'
    ));
    planGroup.add(_makeComboRow(
        'Data Source Mode',
        'How to combine API and heuristic data.',
        ['Hybrid (API anchor + live heuristic delta)', 'API only (update on each API fetch)'],
        ['hybrid', 'api-only'],
        settings, 'data-source-mode'
    ));
    planGroup.add(_makeSpinRow(
        'API Fetch Interval',
        'How often to call the Anthropic API (seconds, min 10).',
        settings, 'api-fetch-interval', 10, 3600, 30
    ));
    planGroup.add(_makeSwitchRow(
        'Show API Update Time',
        'Display how long ago the last API fetch was.',
        settings, 'show-api-update-time'
    ));

    const metricGroup = new Adw.PreferencesGroup({ title: 'Metric' });
    page.add(metricGroup);
    metricGroup.add(_makeComboRow(
        'Bar Metric',
        'What the progress bar represents.',
        ['Cost ($)', 'Tokens'],
        ['cost', 'tokens'],
        settings, 'bar-metric'
    ));

    const generalGroup = new Adw.PreferencesGroup({ title: 'General' });
    page.add(generalGroup);
    generalGroup.add(_makeSpinRow(
        'Refresh Interval',
        'How often to re-read data files (seconds).',
        settings, 'refresh-interval', 5, 120, 5
    ));
    generalGroup.add(_makeComboRow(
        'Panel Position',
        'Which side of the top bar to place the indicator.',
        ['Right', 'Left'],
        ['right', 'left'],
        settings, 'panel-position'
    ));

    return page;
}

// ── Page 2: Appearance ────────────────────────────────────────────────────────

function _buildAppearancePage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Appearance',
        icon_name: 'applications-graphics-symbolic',
    });

    const elementsGroup = new Adw.PreferencesGroup({
        title: 'Panel Elements',
        description: 'Toggle what to show in the panel indicator.',
    });
    page.add(elementsGroup);
    elementsGroup.add(_makeSwitchRow('Show Icon', 'Claude icon or symbolic icon in the panel.', settings, 'show-icon'));
    elementsGroup.add(_makeSwitchRow('Show Bar', 'Progress bar showing usage against plan limit.', settings, 'show-bar'));
    elementsGroup.add(_makeSwitchRow('Show Percentage', 'Usage percentage text (e.g., 70%).', settings, 'show-percentage'));
    elementsGroup.add(_makeSwitchRow('Show Time', 'Time remaining or reset countdown.', settings, 'show-time'));
    elementsGroup.add(_makeSwitchRow('Show Status Dot', 'Colored dot indicating usage level (green/yellow/red).', settings, 'show-status-dot'));
    elementsGroup.add(_makeSwitchRow('Show Status Badge', 'Small colored dot overlay on the icon corner.', settings, 'show-status-badge'));

    const timeGroup = new Adw.PreferencesGroup({ title: 'Time Display' });
    page.add(timeGroup);
    timeGroup.add(_makeComboRow(
        'Time Display',
        'What time info to show when "Show Time" is enabled.',
        ['None', 'Estimated time remaining', 'Reset countdown'],
        ['none', 'remaining', 'reset'],
        settings, 'time-display'
    ));

    const prefixGroup = new Adw.PreferencesGroup({ title: 'Prefix' });
    page.add(prefixGroup);
    prefixGroup.add(_makeSwitchRow('Show Claude Prefix', 'Display a label or icon before the bar.', settings, 'show-prefix'));
    prefixGroup.add(_makeComboRow(
        'Prefix Style',
        'Show the word "Claude", the Claude icon, or a symbolic icon.',
        ['Text', 'Icon', 'Symbolic Icon'],
        ['text', 'icon', 'symbolic'],
        settings, 'prefix-style'
    ));

    const barGroup = new Adw.PreferencesGroup({ title: 'Progress Bar' });
    page.add(barGroup);
    barGroup.add(_makeComboRow(
        'Bar Style',
        'Visual style for the progress bar. Middle-click to cycle.',
        [
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
        ],
        ['blocks', 'smooth', 'dots', 'squares', 'thin', 'pill', 'thick-rounded', 'segmented', 'glow-edge', 'vbar', 'vbar-dual'],
        settings, 'bar-style'
    ));
    barGroup.add(_makeSpinRow('Bar Length', 'Number of segments in the progress bar.', settings, 'bar-length', 5, 30, 1));

    const colorRow = _makeComboRow(
        'Bar Color',
        'Color scheme for the progress bar.',
        [
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
        ],
        ['white', 'green-red', 'blue', 'purple', 'amber', 'rainbow', 'dracula', 'nord', 'catppuccin', 'neon', 'sunset', 'ocean', 'solarized', 'accent', 'custom'],
        settings, 'bar-color'
    );
    barGroup.add(colorRow);

    // Custom gradient color pickers (Gtk.ColorButton for GNOME 42 compat)
    const customStartRow = new Adw.ActionRow({
        title: 'Gradient Start Color',
        subtitle: 'Start of the custom gradient.',
    });
    const startRgba = new Gdk.RGBA();
    startRgba.parse(settings.get_string('custom-color-start'));
    const startBtn = new Gtk.ColorButton({ rgba: startRgba, valign: Gtk.Align.CENTER });
    startBtn.connect('color-set', () => {
        const rgba = startBtn.get_rgba();
        settings.set_string('custom-color-start',
            '#' + Math.round(rgba.red * 255).toString(16).padStart(2, '0')
               + Math.round(rgba.green * 255).toString(16).padStart(2, '0')
               + Math.round(rgba.blue * 255).toString(16).padStart(2, '0'));
    });
    customStartRow.add_suffix(startBtn);
    customStartRow.set_sensitive(settings.get_string('bar-color') === 'custom');
    barGroup.add(customStartRow);

    const customEndRow = new Adw.ActionRow({
        title: 'Gradient End Color',
        subtitle: 'End of the custom gradient.',
    });
    const endRgba = new Gdk.RGBA();
    endRgba.parse(settings.get_string('custom-color-end'));
    const endBtn = new Gtk.ColorButton({ rgba: endRgba, valign: Gtk.Align.CENTER });
    endBtn.connect('color-set', () => {
        const rgba = endBtn.get_rgba();
        settings.set_string('custom-color-end',
            '#' + Math.round(rgba.red * 255).toString(16).padStart(2, '0')
               + Math.round(rgba.green * 255).toString(16).padStart(2, '0')
               + Math.round(rgba.blue * 255).toString(16).padStart(2, '0'));
    });
    customEndRow.add_suffix(endBtn);
    customEndRow.set_sensitive(settings.get_string('bar-color') === 'custom');
    barGroup.add(customEndRow);

    // Update custom row sensitivity when color selection changes
    colorRow.connect('notify::selected', () => {
        const keys = ['white', 'green-red', 'blue', 'purple', 'amber', 'rainbow', 'dracula', 'nord', 'catppuccin', 'neon', 'sunset', 'ocean', 'solarized', 'accent', 'custom'];
        const isCustom = keys[colorRow.get_selected()] === 'custom';
        customStartRow.set_sensitive(isCustom);
        customEndRow.set_sensitive(isCustom);
    });

    const panelGroup = new Adw.PreferencesGroup({ title: 'Panel Style' });
    page.add(panelGroup);
    panelGroup.add(_makeComboRow(
        'Pill Background',
        'Background style for the panel button.',
        [
            'Off \u2014 transparent',
            'Solid \u2014 visible pill with fill + border',
            'Subtle \u2014 semi-transparent background',
            'Border Only \u2014 outline, no fill',
            'Status \u2014 color changes with usage',
            'Glow \u2014 purple neon glow',
        ],
        ['off', 'solid', 'subtle', 'border-only', 'status', 'glow'],
        settings, 'pill-background'
    ));

    const dropdownGroup = new Adw.PreferencesGroup({ title: 'Dropdown Menu' });
    page.add(dropdownGroup);
    dropdownGroup.add(_makeComboRow(
        'Dropdown Style',
        'Style for the click-to-expand menu.',
        [
            'Classic \u2014 simple text rows',
            'Modern \u2014 progress bar, colored dots, sparkline',
            'Gauges \u2014 circular arc gauges',
        ],
        ['classic', 'modern', 'gauges'],
        settings, 'dropdown-style'
    ));

    return page;
}

// ── Page 3: Advanced ──────────────────────────────────────────────────────────

function _buildAdvancedPage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Advanced',
        icon_name: 'preferences-other-symbolic',
    });

    const typoGroup = new Adw.PreferencesGroup({
        title: 'Typography',
        description: 'Font size and text effects for the panel indicator.',
    });
    page.add(typoGroup);
    typoGroup.add(_makeComboRow(
        'Font Size',
        'Size of the panel indicator text.',
        ['Small (10px)', 'Medium (12px)', 'Large (14px)'],
        ['small', 'medium', 'large'],
        settings, 'font-size'
    ));
    typoGroup.add(_makeComboRow(
        'Text Effect',
        'Visual effect applied to panel text.',
        ['None', 'Glow \u2014 bright vivid color', 'Shadow \u2014 dimmer muted text'],
        ['none', 'glow', 'shadow'],
        settings, 'text-effect'
    ));

    const pulseGroup = new Adw.PreferencesGroup({
        title: 'Pulse Animation',
        description: 'Flicker effect at high usage levels.',
    });
    page.add(pulseGroup);
    pulseGroup.add(_makeSwitchRow('Enable Pulse', 'Pulse the indicator when usage exceeds threshold.', settings, 'enable-pulse'));
    pulseGroup.add(_makeSpinRow('Pulse Threshold (%)', 'Usage percentage at which pulsing begins.', settings, 'pulse-threshold', 50, 100, 5));

    const orderGroup = new Adw.PreferencesGroup({
        title: 'Element Order',
        description: 'Arrange elements left-to-right in the panel indicator.',
    });
    page.add(orderGroup);

    const orderKeys = ['icon', 'label', 'bar', 'dot'];
    const elementLabels = { icon: 'Icon', label: 'Label (text/percentage/time)', bar: 'Progress Bar', dot: 'Status Dot' };
    const positionNames = ['1st', '2nd', '3rd', '4th'];
    const positionRows = [];

    const getCurrentOrder = () =>
        settings.get_string('element-order').split(',').map(s => s.trim()).filter(Boolean);

    const updateOrderSetting = () => {
        const order = positionRows.map(row => orderKeys[row.get_selected()]);
        if (new Set(order).size === order.length)
            settings.set_string('element-order', order.join(','));
    };

    const currentOrder = getCurrentOrder();
    for (let i = 0; i < 4; i++) {
        const row = new Adw.ComboRow({ title: `Position ${positionNames[i]}` });
        row.set_model(Gtk.StringList.new(orderKeys.map(k => elementLabels[k])));
        const elem = currentOrder[i] || orderKeys[i];
        row.set_selected(Math.max(0, orderKeys.indexOf(elem)));
        row.connect('notify::selected', updateOrderSetting);
        orderGroup.add(row);
        positionRows.push(row);
    }

    return page;
}
