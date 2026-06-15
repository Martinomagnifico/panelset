import type { FlowDef, StepDef } from './types';
import { inMemoryLoader, type Loader } from './loader';

const ID_TOKEN = /\{id\}|:id/;
// An inline source is a CSS selector for an element on the page: an #id, or a
// .class / [attr] selector that carries no path separator. A relative file path
// like "../flow.json" also starts with "." — the no-slash rule keeps it out.
const INLINE_SEL = (src: string) => src.startsWith('#') || (/^[.[]/.test(src) && !src.includes('/'));

/**
 * Build a Loader from a declared source string — the convenience behind a
 * `data-panelflow-src` attribute. Three shapes, chosen by the value:
 *   • "#sel"            → inline: parse JSON from the matched element, serve by id
 *   • "/path/:id"       → endpoint: fetch one step per id (`{id}` also works)
 *   • "/path/flow.json" → static file: fetch the whole flow once, then serve by id
 * Anything beyond these (auth headers, GraphQL, transforms, retries) → pass your
 * own Loader to FlowController instead. Browser-coupled (uses document / fetch);
 * the pure engine never imports this.
 */
export function loaderFromSource(src: string): Loader {
	// Inline JSON held in an element (typically a <script type="application/json">).
	if (INLINE_SEL(src)) {
		let inner: Loader | null = null;
		return async (id) => {
			if (!inner) {
				const el = document.querySelector(src);
				if (!el) throw new Error(`PanelFlow: no element "${src}" for inline flow`);
				inner = inMemoryLoader(JSON.parse(el.textContent || 'null') as FlowDef);
			}
			return inner(id);
		};
	}

	// Per-id endpoint: the URL carries an :id / {id} token.
	if (ID_TOKEN.test(src)) {
		return async (id) => {
			const res = await fetch(src.replace(ID_TOKEN, encodeURIComponent(id)));
			if (!res.ok) throw new Error(`PanelFlow: ${res.status} loading step "${id}"`);
			return { ...((await res.json()) as StepDef), id }; // requested id is authoritative
		};
	}

	// Static file: fetch the whole flow once, then serve steps by id.
	let whole: Promise<Loader> | null = null;
	return (id) => {
		whole ??= fetch(src).then(async (res) => {
			if (!res.ok) throw new Error(`PanelFlow: ${res.status} loading flow from "${src}"`);
			return inMemoryLoader((await res.json()) as FlowDef);
		});
		return whole.then((load) => load(id));
	};
}
