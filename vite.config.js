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
    dts({ insertTypesEntry: true, outDir: 'dist', include: ['src/js/**/*'], rollupTypes: true }),
    iifeBuild()
  ],
  build: {
    lib: {
      entry: {
        'panelset.esm': resolve(__dirname, 'src/js/index.ts'),
        'register': resolve(__dirname, 'src/js/register.ts'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      output: {
        chunkFileNames: 'panelset-core.js'
      }
    },
    sourcemap: true,
    minify: 'oxc',
    target: 'es2020'
  },
  server: {
    host: true,
    open: "index.html",
}
});