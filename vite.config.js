// vite.config.ts
import { defineConfig, build } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

const iifeBuild = () => ({
  name: 'iife-build',
  closeBundle: async () => {
    await build({
      configFile: false,
      build: {
        lib: {
          entry: resolve(__dirname, 'src/js/index.iife.ts'),
          name: 'PanelSet',
          formats: ['iife'],
          fileName: () => 'panelset.js'
        },
        emptyOutDir: false,
        sourcemap: false,
        minify: 'terser',
        terserOptions: {
          // Smaller bundle.
          mangle: { properties: { regex: /^_/ } },
          compress: { passes: 3 }
        },
        target: 'es2020'
      }
    });
  }
});



export default defineConfig({
  plugins: [
    // The types in one file per entry: dist/types/index.d.ts and register.d.ts.
    dts({
      bundleTypes: true,
      outDirs: 'dist/types',
      entryRoot: 'src/js',
      entries: { index: 'src/js/index.ts', register: 'src/js/register.ts' },
      include: ['src/js/**/*'],
      exclude: ['src/js/index.iife.ts'],
      // register only runs register(), and exports nothing.
      beforeWriteFile: (filePath, content) =>
        filePath.endsWith('register.d.ts') ? { filePath, content: 'export {};\n' } : { filePath, content }
    }),
    iifeBuild()
  ],
  build: {
    // One ES module per entry: dist/panelset.mjs and dist/register.mjs, which
    // imports panelset.mjs. No source maps in the package.
    lib: {
      entry: {
        'index': resolve(__dirname, 'src/js/index.ts'),
        'register': resolve(__dirname, 'src/js/register.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      // The code both entries use stays in panelset.mjs, not in a third file.
      preserveEntrySignatures: 'allow-extension',
      output: {
        entryFileNames: (chunk) => (chunk.name === 'index' ? 'panelset.mjs' : '[name].mjs'),
        chunkFileNames: '[name].mjs',
        assetFileNames: '[name][extname]',
      }
    },
    sourcemap: false,
    minify: 'oxc',
    target: 'es2020'
  },
  server: {
    host: true,
    open: "index.html",
}
});