import { defineConfig } from 'vite';
import { resolve } from "path";
import { readFileSync } from "fs";
import vituum from "vituum";
import pug from '@vituum/vite-plugin-pug';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const navData = JSON.parse(readFileSync(new URL('./src/data/nav.json', import.meta.url), 'utf-8'));

// Where the docs actually live. Open Graph needs ABSOLUTE urls: a relative og:image is
// simply ignored, and that is why a pasted link showed no card.
const SITE_URL = 'https://martinomagnifico.github.io/panelset/';

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
				// og:url and the canonical link have to be absolute AND different on every page, which
				// is the one thing a Pug template cannot work out for itself. Vite knows the output
				// path of each page, so they are written here instead of being hand-typed per page,
				// where they would rot the first time a file moved.
				name: 'og-url',
				transformIndexHtml(html, ctx) {
					// ctx.path is the SOURCE path (src/views/panel/api.pug.html), not the page's
					// final url, so strip Vituum's plumbing back off it.
					const path = (ctx.path || '/')
						.replace(/^\//, '')
						.replace(/^src\/views\//, '')
						.replace(/\.pug\.html$/, '.html');
					const url = SITE_URL + (path === 'index.html' ? '' : path);
					return html.replace(
						'<meta property="og:type"',
						`<meta property="og:url" content="${url}">\n<link rel="canonical" href="${url}">\n<meta property="og:type"`
					);
				},
			},
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
					siteUrl: SITE_URL, // absolute, for Open Graph: a relative og:image is ignored
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
					: resolve(__dirname, '../dist/esm/index.js')
			}
		}
	};
});