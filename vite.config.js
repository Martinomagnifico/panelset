// vite.config.ts
import { defineConfig, build } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';
import { rename, mkdir, readdir, rmdir } from 'fs/promises';

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


const groupTypes = () => ({
  name: 'group-types',
  closeBundle: async () => {
    const dist = resolve(__dirname, 'dist');
    const typesDir = resolve(dist, 'types');

    const moveTypes = async (relDir) => {
      const absDir = resolve(dist, relDir);
      for (const e of await readdir(absDir, { withFileTypes: true })) {
        const rel = relDir ? `${relDir}/${e.name}` : e.name;
        if (rel === 'types') continue;
        if (e.isDirectory()) {
          await moveTypes(rel);
          // Drop the source folder if moving its .d.ts left it empty.
          await rmdir(resolve(dist, rel)).catch(() => {});
        } else if (e.name.endsWith('.d.ts') || e.name.endsWith('.d.ts.map')) {
          const dest = resolve(typesDir, rel);
          await mkdir(resolve(dest, '..'), { recursive: true });
          await rename(resolve(dist, rel), dest);
        }
      }
    };

    await mkdir(typesDir, { recursive: true });
    await moveTypes('');
  }
});

export default defineConfig({
  plugins: [
    dts({ insertTypesEntry: true, outDir: 'dist', include: ['src/js/**/*'] }),
    iifeBuild(),
    groupTypes()
  ],
  build: {
    lib: {
      entry: {
        'index': resolve(__dirname, 'src/js/index.ts'),
        'register': resolve(__dirname, 'src/js/register.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src/js',
        entryFileNames: 'esm/[name].js',
        chunkFileNames: 'esm/[name].js',
        assetFileNames: '[name][extname]',
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