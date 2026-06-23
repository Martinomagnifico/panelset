import { defineConfig } from 'vite';
import { resolve } from "path";
import { readFileSync } from "fs";
import vituum from "vituum";
import pug from '@vituum/vite-plugin-pug';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const navData = JSON.parse(readFileSync(new URL('./src/data/nav.json', import.meta.url), 'utf-8'));

export default defineConfig(({ mode }) => {
	const isDev = mode === 'development';
    const isProd = mode === 'production';

	return {
		base: isProd ? '/panelset/' : '/',
		build: {
	        outDir: "dist",
	        emptyOutDir: false,
	        rollupOptions: {
	            input: [
					resolve(__dirname, "src/views/**/[!_]*.pug"),
	                resolve(__dirname, "src/assets/styles/[!_]*.scss"),
	                resolve(__dirname, "src/assets/scripts/[!_]*.js")
	            ],
	            output: {
	                entryFileNames: (chunkInfo) => {
	                    if (chunkInfo.name === 'main') {
	                        return "assets/scripts/main.js";
	                    }
	                    if (chunkInfo.name === 'copybutton') {
	                        return "assets/scripts/copybutton.js";
	                    }
	                    return "assets/scripts/[name].js";
	                },
	                assetFileNames: (assetInfo) => {
	                    if (/\.css$/.test(assetInfo.names[0])) {
	                        return "assets/style/[name].[ext]";
	                    }
	                    return "assets/[name].[ext]";
	                },
	            }
	        },
	    },
		plugins: [
			{
				name: 'pug-full-reload',
				configureServer(server) {
					server.watcher.add(resolve(__dirname, 'src/**/*.pug'));
				},
				handleHotUpdate({ file, server, modules }) {
					if (file.endsWith('.pug')) {
						modules.forEach(mod => server.moduleGraph.invalidateModule(mod));
						server.moduleGraph.invalidateAll();
						const hot = server.hot ?? server.ws;
						setTimeout(() => hot.send({ type: 'full-reload' }), 150);
					}
				}
			},
            viteStaticCopy({
                targets: [
                { src: '../dist/panelset.js', dest: 'lib' },
                { src: '../dist/panelset.css', dest: 'lib' }
                ]
            }),
			vituum({
	            pages: {
	                dir: "src/views",
	                normalizeBasePath: true,
	            },
	        }),
	        pug({
	            root: "src",
				globals: {
					isProd: isProd,
					basePath: isProd ? '/panelset/' : '/',
					url: (h) => (isProd ? '/panelset/' : '/') + String(h).replace(/^\//, ''),
					sidebar: navData,
				},
	            options: {
	                pretty: true,
	                cache: false,
	                doctype: 'html',
	            }
	        })
		],
	    server: {
	        host: true,
	        open: "index.html",
	    },
		css: {
	        preprocessorOptions: {
	            scss: {
	                api: "modern"
	            }
	        }
	    },
		resolve: {
			alias: {
				'panelset': isDev
					? resolve(__dirname, '../src/js/index.ts')
					: resolve(__dirname, '../dist/panelset.esm.js')
			}
		}
	};
});