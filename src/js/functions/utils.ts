/**
 * Shared debug logger. Both Panel and PanelSet use this pattern.
 */
export function log(prefix: string, element: HTMLElement, debug: boolean, message: string): void {
	if (!debug) return;
	console.log(`[${prefix}] "${element.id || 'no id'}" -`, message);
}


/**
 * Add or remove id token(s) on an element's aria-describedby, leaving any other
 * tokens (author-set descriptions) intact. `ids` may be a single id or a
 * space-separated list. Used to attach a "why is this disabled" hint only while
 * a control is disabled, so it is not announced when the control is enabled.
 */
export function setDescribedBy(el: HTMLElement, ids: string, present: boolean): void {
	const want = ids.split(/\s+/).filter(Boolean);
	if (!want.length) return;
	const cur = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
	let changed = false;
	for (const id of want) {
		const has = cur.includes(id);
		if (present && !has) { cur.push(id); changed = true; }
		else if (!present && has) { cur.splice(cur.indexOf(id), 1); changed = true; }
	}
	if (!changed) return;
	if (cur.length) el.setAttribute('aria-describedby', cur.join(' '));
	else el.removeAttribute('aria-describedby');
}


let _interpolateSizeLogged = false;

/**
 * Logs browser interpolate-size support once across all Panel and PanelSet instances.
 * No-ops if debug is false or the message has already been logged.
 */
export function logInterpolateSizeOnce(debug: boolean): void {
	if (!debug || _interpolateSizeLogged) return;
	_interpolateSizeLogged = true;
	console.log("[Panel/PanelSet] Browser supports 'interpolate-size', which will be used for opening and closing.");
}


/** A before-open event detail that carries an awaitable promise for async content. */
export interface Awaitable {
	/** Underlying mechanism the open awaits; prefer waitUntil(). */
	promise: Promise<unknown> | null;
	/** Delay the open until p resolves. Safe to call more than once (the open awaits
	 *  all of them), and safe to destructure (it closes over the detail, not `this`). */
	waitUntil(p: Promise<unknown>): void;
}

/**
 * Wire detail.waitUntil() so it sets detail.promise, combining via Promise.all when
 * called more than once. Direct `detail.promise = …` keeps working alongside it.
 */
export function attachWaitUntil(detail: Awaitable): void {
	detail.waitUntil = (p) => {
		detail.promise = detail.promise ? Promise.all([detail.promise, p]) : p;
	};
}

/**
 * Register an async content handler on a CustomEvent.
 * The handler receives the target element and an AbortSignal.
 * If it returns a Promise, it is handed to event.detail.waitUntil() so the
 * consuming code awaits it (combining with any other waitUntil calls).
 * Pass once:true to skip the handler after the first successful load
 * (tracked via target.dataset.loaded).
 */
export function registerBeforeOpenHandler<D extends Awaitable & { signal: AbortSignal }>(
	element: HTMLElement,
	eventName: string,
	getTarget: (detail: D) => HTMLElement,
	handler: (target: HTMLElement, signal: AbortSignal) => Promise<void> | void,
	options: { once?: boolean } = {}
): void {
	const once = options.once === true;
	element.addEventListener(eventName, (e) => {
		const event = e as CustomEvent<D>;
		const target = getTarget(event.detail);
		const { signal } = event.detail;
		if (once && target.dataset.loaded === 'true') return;
		const result = handler(target, signal);
		if (result && typeof result.then === 'function') {
			event.detail.waitUntil(result.then(() => {
				if (once) target.dataset.loaded = 'true';
			}));
		}
	});
}
