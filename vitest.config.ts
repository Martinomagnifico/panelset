import { defineConfig } from 'vitest/config';

// PanelFlow engine tests. Phases 1–4 are pure (node). The phase-5 tests touch the
// DOM, so those files opt into jsdom with `// @vitest-environment jsdom`.
export default defineConfig({
	plugins: [{
		// Stub style imports so importing the real PanelSet (which does
		// `import '...panelset.scss'`) doesn't run sass during tests.
		name: 'panelflow-stub-styles',
		enforce: 'pre',
		resolveId(id) {
			return id.endsWith('.scss') || id.endsWith('.css') ? '\0styles-stub' : null;
		},
		load(id) {
			return id === '\0styles-stub' ? '' : null;
		},
	}],
	test: {
		include: ['panelflow/**/*.test.ts'],
		environment: 'node',
	},
});
