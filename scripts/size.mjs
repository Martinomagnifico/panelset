// Report the gzipped, tree-shaken size of each public class on its own, and the
// full bundle. Uses Vite's build API (already a devDep) — no extra tooling.
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
		const js = readdirSync(out).find((f) => /\.(mjs|js)$/.test(f));
		const raw = readFileSync(join(out, js));
		rows.push({ label, gzip: gzipSync(raw, { level: 9 }).length, raw: raw.length });
	} finally {
		rmSync(entry, { force: true });
		rmSync(out, { recursive: true, force: true });
	}
}

const kb = (n) => (n / 1024).toFixed(1) + ' kB';
console.log('\ngzipped JS size (tree-shaken, ESM, terser):\n');
for (const r of rows) {
	console.log(`  ${r.label.padEnd(18)} ${kb(r.gzip).padStart(8)}   (raw ${kb(r.raw)})`);
}
console.log('\nThe classes share internal helpers, so standalone sizes overlap and');
console.log('do not sum to the full bundle.\n');
