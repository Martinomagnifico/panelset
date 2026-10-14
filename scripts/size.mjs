// Report the gzipped, tree-shaken size of each public class on its own, the
// full bundle and the stylesheet. Uses Vite's build API (already a devDep) — no extra tooling.
// The numbers are also saved in docs/src/data/size.json, for the docs as `size.js`, `size.css` and `size.total`.
//
//   npm run size
//
// Note: the classes share internal helpers (Core, focus, persist, config, …), so
// the standalone numbers OVERLAP and do not add up to the full bundle.
import { build } from 'vite';
import { gzipSync } from 'node:zlib';
import { writeFileSync, readFileSync, rmSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Entries use paths relative to the repo root (the cwd of `npm run`), so Vite
// bundles the source instead of treating it as an external import.
const entries = {
	'Panel':            `export { Panel } from './src/js/panel';`,
	'PanelSet':         `export { PanelSet } from './src/js/panelset';`,
	'PanelControl':     `export { PanelControl } from './src/js/panelcontrol';`,
	'Panel + PanelSet': `export { Panel, PanelSet } from './src/js/index';`,
	'All three':        `export { Panel, PanelSet, PanelControl } from './src/js/index';`,
};

const rows = [];
let css = null;
let i = 0;
for (const [label, code] of Object.entries(entries)) {
	const entry = `./.size-entry-${i++}.mjs`;
	const out = mkdtempSync(join(tmpdir(), 'panelset-size-'));
	writeFileSync(entry, code);
	try {
		await build({
			configFile: false,
			logLevel: 'silent',
			build: {
				outDir: out,
				emptyOutDir: false,
				minify: 'terser',
				cssCodeSplit: false,
				lib: { entry, formats: ['es'], fileName: 'out' },
			},
		});
		const files = readdirSync(out);
		const js = files.find((f) => /\.(mjs|js)$/.test(f));
		const raw = readFileSync(join(out, js));
		rows.push({ label, gzip: gzipSync(raw, { level: 9 }).length, raw: raw.length });
		const cssFile = files.find((f) => f.endsWith('.css'));
		if (!css && cssFile) {
			const rawCss = readFileSync(join(out, cssFile));
			css = { label: 'Stylesheet (CSS)', gzip: gzipSync(rawCss, { level: 9 }).length, raw: rawCss.length };
		}
	} finally {
		rmSync(entry, { force: true });
		rmSync(out, { recursive: true, force: true });
	}
}

if (css) rows.push(css);

// In kB with two decimals, gzipped, so the docs can round once. The JavaScript is the full bundle (all three classes).
const round = (n) => Math.round((n / 1024) * 100) / 100;
const gzipOf = (label) => rows.find((r) => r.label === label)?.gzip ?? 0;
const size = {
	js: round(gzipOf('All three')),
	css: round(css?.gzip ?? 0),
	total: round(gzipOf('All three') + (css?.gzip ?? 0)),
	entries: Object.fromEntries(rows.map((r) => [r.label, round(r.gzip)])),
};
const data = fileURLToPath(new URL('../docs/src/data/size.json', import.meta.url));
writeFileSync(data, JSON.stringify({ size }, null, '\t') + '\n');

const kb = (n) => (n / 1024).toFixed(1) + ' kB';
console.log('\ngzipped size (tree-shaken, ESM, terser):\n');
for (const r of rows) {
	console.log(`  ${r.label.padEnd(18)} ${kb(r.gzip).padStart(8)}   (raw ${kb(r.raw)})`);
}
console.log('\nThe classes share internal helpers, so standalone sizes overlap and');
console.log('do not sum to the full bundle.\n');
console.log('Saved in docs/src/data/size.json.\n');
