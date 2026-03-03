import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ClaudeMonitorPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Claude Token Monitor',
            icon_name: 'utilities-system-monitor-symbolic',
        });
        window.add(page);

        // -- Plan group --
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
            'Pro ($20/mo — 19M tokens, $18/5h)',
            'Max 5x ($100/mo — 88M tokens, $35/5h)',
            'Max 20x ($200/mo — 220M tokens, $140/5h)',
        ]);
        planRow.set_model(planModel);

        const planKeys = ['pro', 'max5', 'max20'];
        const currentPlan = settings.get_string('plan-type');
        planRow.set_selected(Math.max(0, planKeys.indexOf(currentPlan)));

        planRow.connect('notify::selected', () => {
            settings.set_string('plan-type', planKeys[planRow.get_selected()]);
        });

        planGroup.add(planRow);

        // Estimation mode
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
        estRow.set_selected(
            Math.max(0, estKeys.indexOf(settings.get_string('estimation-mode')))
        );
        estRow.connect('notify::selected', () => {
            settings.set_string('estimation-mode', estKeys[estRow.get_selected()]);
        });
        planGroup.add(estRow);

        // -- Indicator style group --
        const styleGroup = new Adw.PreferencesGroup({
            title: 'Indicator Style',
            description: 'Customize what appears in the panel.',
        });
        page.add(styleGroup);

        // Show prefix
        const prefixRow = new Adw.SwitchRow({
            title: 'Show Claude Prefix',
            subtitle: 'Display a label or icon before the bar.',
        });
        settings.bind('show-prefix', prefixRow, 'active', 0);
        styleGroup.add(prefixRow);

        // Prefix style: text vs icon
        const prefixStyleRow = new Adw.ComboRow({
            title: 'Prefix Style',
            subtitle: 'Show the word "Claude" or the Claude icon.',
        });
        const prefixStyleModel = Gtk.StringList.new(['Text', 'Icon']);
        prefixStyleRow.set_model(prefixStyleModel);
        const prefixStyleKeys = ['text', 'icon'];
        prefixStyleRow.set_selected(
            Math.max(0, prefixStyleKeys.indexOf(settings.get_string('prefix-style')))
        );
        prefixStyleRow.connect('notify::selected', () => {
            settings.set_string('prefix-style', prefixStyleKeys[prefixStyleRow.get_selected()]);
        });
        styleGroup.add(prefixStyleRow);

        // Bar style
        const barStyleRow = new Adw.ComboRow({
            title: 'Bar Style',
            subtitle: 'Visual style for the progress bar.',
        });
        const barStyleModel = Gtk.StringList.new([
            'Blocks  \u2588\u2588\u2588\u2591\u2591',
            'Smooth  \u2588\u2588\u258C\u2591\u2591',
            'Dots  \u25CF\u25CF\u25CF\u25CB\u25CB',
            'Squares  \u25A0\u25A0\u25A0\u25A1\u25A1',
            'Thin  \u25B0\u25B0\u25B0\u25B1\u25B1',
        ]);
        barStyleRow.set_model(barStyleModel);
        const barStyleKeys = ['blocks', 'smooth', 'dots', 'squares', 'thin'];
        barStyleRow.set_selected(
            Math.max(0, barStyleKeys.indexOf(settings.get_string('bar-style')))
        );
        barStyleRow.connect('notify::selected', () => {
            settings.set_string('bar-style', barStyleKeys[barStyleRow.get_selected()]);
        });
        styleGroup.add(barStyleRow);

        // Bar length
        const barRow = new Adw.SpinRow({
            title: 'Bar Length',
            subtitle: 'Number of segments in the progress bar.',
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 30,
                step_increment: 1,
                value: settings.get_int('bar-length'),
            }),
        });
        barRow.connect('notify::value', () => {
            settings.set_int('bar-length', barRow.get_value());
        });
        styleGroup.add(barRow);

        // Bar color scheme
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
        ]);
        colorRow.set_model(colorModel);
        const colorKeys = ['white', 'green-red', 'blue', 'purple', 'amber', 'rainbow'];
        colorRow.set_selected(
            Math.max(0, colorKeys.indexOf(settings.get_string('bar-color')))
        );
        colorRow.connect('notify::selected', () => {
            settings.set_string('bar-color', colorKeys[colorRow.get_selected()]);
        });
        styleGroup.add(colorRow);

        // Bar metric
        const metricRow = new Adw.ComboRow({
            title: 'Bar Metric',
            subtitle: 'What the progress bar represents.',
        });
        const metricModel = Gtk.StringList.new(['Cost ($)', 'Tokens']);
        metricRow.set_model(metricModel);
        const metricKeys = ['cost', 'tokens'];
        metricRow.set_selected(
            Math.max(0, metricKeys.indexOf(settings.get_string('bar-metric')))
        );
        metricRow.connect('notify::selected', () => {
            settings.set_string('bar-metric', metricKeys[metricRow.get_selected()]);
        });
        styleGroup.add(metricRow);

        // Show time remaining
        const timeRow = new Adw.SwitchRow({
            title: 'Show Time Remaining',
            subtitle: 'Display estimated time until plan limit.',
        });
        settings.bind('show-time-remaining', timeRow, 'active', 0);
        styleGroup.add(timeRow);

        // -- General group --
        const displayGroup = new Adw.PreferencesGroup({
            title: 'General',
        });
        page.add(displayGroup);

        // Refresh interval
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

        displayGroup.add(refreshRow);

        // Panel position
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

        displayGroup.add(posRow);
    }
}
