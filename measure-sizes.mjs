import { build } from 'vite';
import { gzipSync } from 'node:zlib';
import { writeFileSync, readFileSync, rmSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const entries = {
	'Panel only':        `export { Panel } from './src/js/panel';`,
	'PanelSet only':     `export { PanelSet } from './src/js/panelset';`,
	'PanelControl only': `export { PanelControl } from './src/js/panelcontrol';`,
	'Panel + PanelSet':  `export { Panel, PanelSet } from './src/js/index';`,
	'All three':         `export { Panel, PanelSet, PanelControl } from './src/js/index';`,
};
const results = {}, raws = {};
let i = 0;
for (const [label, code] of Object.entries(entries)) {
	const entry = `./_sz_entry_${i++}.js`;
	writeFileSync(entry, code);
	const dir = mkdtempSync(join(tmpdir(), 'sz-'));
	try {
		await build({ configFile: false, logLevel: 'silent',
			build: { outDir: dir, emptyOutDir: false, minify: 'terser', cssCodeSplit: false,
				lib: { entry, formats: ['es'], fileName: 'out' } } });
		const jsFile = readdirSync(dir).find(f => /\.(mjs|js)$/.test(f));
		const raw = readFileSync(join(dir, jsFile));
		raws[label] = raw.length;
		results[label] = gzipSync(raw, { level: 9 }).length;
	} finally { rmSync(entry, { force: true }); rmSync(dir, { recursive: true, force: true }); }
}
const kb = n => (n / 1024).toFixed(1) + ' kB';
console.log('\n=== JS size (tree-shaken, ESM, terser) ===');
for (const k of Object.keys(results))
	console.log(`  ${k.padEnd(20)} gzip ${kb(results[k]).padStart(8)}  (raw ${kb(raws[k])})`);
