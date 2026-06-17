// Drives the install-wizard mixin (the "Setup" card): builds the code snippets from
// the wizard's data-iw-imports, wires the Format/Usage selects, and remembers the
// chosen tab + selects in localStorage so the choice carries across every page.
//
// Runs from the global block (before each page's PanelSet.init), so it can set the
// saved tab active before PanelSet reads the starting panel.
(function () {
	var KEY = 'panelset-docs:install-prefs';

	function load() {
		try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
	}
	function save(patch) {
		try { localStorage.setItem(KEY, JSON.stringify(Object.assign(load(), patch))); } catch (e) {}
	}

	// Only the imports binding varies between components; everything else is shared.
	function buildSnippets(imports, cdn) {
		return {
			npm: {
				lang: 'js',
				api: "import { " + imports + " } from 'panelset';\nimport 'panelset/style.css';",
				wc:  "import { " + imports + ", register } from 'panelset';\nimport 'panelset/style.css';\n\nregister();"
			},
			download: {
				esm: {
					lang: 'js',
					api: "import { " + imports + " } from './panelset.esm.js';\nimport './panelset.css';",
					wc:  "import { " + imports + ", register } from './panelset.esm.js';\nimport './panelset.css';\n\nregister();"
				},
				iife: {
					lang: 'html',
					api: '<link rel="stylesheet" href="panelset.css">\n<script src="panelset.js"><\/script>',
					wc:  '<link rel="stylesheet" href="panelset.css">\n<script src="panelset.js"><\/script>\n<!-- custom elements are registered automatically -->'
				}
			},
			cdn: {
				lang: 'html',
				api: '<link rel="stylesheet" href="' + cdn + '/panelset.css">\n<script src="' + cdn + '/panelset.js"><\/script>',
				wc:  '<link rel="stylesheet" href="' + cdn + '/panelset.css">\n<script src="' + cdn + '/panelset.js"><\/script>\n<!-- custom elements are registered automatically -->'
			}
		};
	}

	function updatePanel(panel, snippets) {
		var source   = panel.dataset.iwSource;
		var formatEl = panel.querySelector('.iw-format');
		var usageEl  = panel.querySelector('.iw-usage');
		var codeEl   = panel.querySelector('.iw-code');
		var langEl   = panel.querySelector('.iw-lang');
		var format = formatEl ? formatEl.value : 'esm';
		var usage  = usageEl  ? usageEl.value  : 'api';

		var data;
		if (source === 'npm' || source === 'cdn') {
			data = { lang: snippets[source].lang, code: snippets[source][usage] };
		} else {
			var group = snippets[source][format];
			data = { lang: group.lang, code: group[usage] };
		}

		if (codeEl) codeEl.textContent = data.code;
		if (langEl) langEl.textContent = data.lang.toUpperCase();
		if (window.hljs && codeEl) {
			codeEl.removeAttribute('data-highlighted');
			codeEl.className = 'iw-code language-' + data.lang;
			hljs.highlightElement(codeEl);
		}
	}

	// Make the saved tab the active panel. Runs before PanelSet.init(), which reads
	// the .active panel as its starting one.
	function setActiveSource(wiz, source) {
		wiz.querySelectorAll('[role="tabpanel"]').forEach(function (panel) {
			var match = panel.dataset.iwSource === source;
			panel.hidden = !match;
			panel.classList.toggle('active', match);
		});
	}

	document.querySelectorAll('.install-wizard').forEach(function (wiz) {
		var imports = wiz.dataset.iwImports || 'PanelSet';
		var cdn = wiz.dataset.iwCdn || 'https://cdn.jsdelivr.net/npm/panelset@latest/dist';
		var snippets = buildSnippets(imports, cdn);
		var prefs = load();
		var cardContent = wiz.querySelector('[data-panelset]');

		// Restore the saved tab + select values, then render every tab.
		if (prefs.source) setActiveSource(wiz, prefs.source);
		wiz.querySelectorAll('[role="tabpanel"]').forEach(function (panel) {
			var u = panel.querySelector('.iw-usage');
			var f = panel.querySelector('.iw-format');
			if (u && prefs.usage)  u.value = prefs.usage;
			if (f && prefs.format) f.value = prefs.format;
			updatePanel(panel, snippets);
		});

		// A select changed: keep the same choice on every tab, persist it, re-render.
		wiz.addEventListener('change', function (e) {
			var sel = e.target.closest && e.target.closest('select');
			if (!sel) return;
			if (sel.classList.contains('iw-usage')) {
				wiz.querySelectorAll('.iw-usage').forEach(function (s) { s.value = sel.value; });
				save({ usage: sel.value });
			} else if (sel.classList.contains('iw-format')) {
				wiz.querySelectorAll('.iw-format').forEach(function (s) { s.value = sel.value; });
				save({ format: sel.value });
			}
			wiz.querySelectorAll('[role="tabpanel"]').forEach(function (panel) { updatePanel(panel, snippets); });
		});

		// Persist the tab whenever PanelSet activates one (covers click + keyboard).
		if (cardContent) {
			cardContent.addEventListener('ps:activationcomplete', function () {
				var active = wiz.querySelector('[role="tabpanel"]:not([hidden])');
				if (active && active.dataset.iwSource) save({ source: active.dataset.iwSource });
			});
		}
	});
})();
