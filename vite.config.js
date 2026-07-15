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

// Move the .d.ts files into dist/types, keeping their folder structure.
// With preserveModules the JS build now mirrors src/js into dist too, so dist holds
// BOTH .js and .d.ts side by side (including in subfolders like functions/). This walks
// the tree and relocates only the type files, leaving the JS mirror in place. A relative
// import inside a .d.ts (`from './panel.js'`) still resolves, because every .d.ts moves
// together and TypeScript maps the .js specifier to the sibling .d.ts.
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
        // Ship one file per source module (mirroring src/js/) instead of a single
        // flattened bundle. A downstream bundler can then prune whole modules at real
        // file boundaries, so `import { Panel }` drops PanelSet and PanelControl. A
        // forced shared chunk hid the implementation behind a re-export the bundler
        // could not shake through.
        preserveModules: true,
        preserveModulesRoot: 'src/js',
        // The ESM mirror lives under dist/esm so src/js/panelset.ts (-> panelset.js)
        // does not collide with the public IIFE artifact dist/panelset.js. The CSS asset
        // stays at the dist root, where package.json's ./style.css export points.
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