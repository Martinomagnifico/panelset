/**
 * Shared debug logger. Both Panel and PanelSet use this pattern.
 */
export function log(prefix: string, element: HTMLElement, debug: boolean, message: string): void {
	if (!debug) return;
	console.log(`[${prefix}] "${element.id || 'no id'}" -`, message);
}


/**
 * Add or remove ids on an element's aria-describedby, leaving your own descriptions alone. `ids` can be one id or a space-separated list.
 * It attaches a "why is this disabled" hint only while the control is disabled, so nobody hears it once the control works again.
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
 * Says once, across every Panel and PanelSet, that the browser has interpolate-size. Quiet if debug is off, or if it has said so already.
 */
// The busy state on one trigger: aria-busy for assistive tech, and a class to style off. Shared by both components, so the attribute and the class name cannot drift apart.
export function setTriggerLoading(trigger: HTMLElement, loading: boolean): void {
	trigger.classList.toggle('is-trigger-loading', loading);
	if (loading) trigger.setAttribute('aria-busy', 'true');
	else trigger.removeAttribute('aria-busy');
}

export function logInterpolateSizeOnce(debug: boolean): void {
	if (!debug || _interpolateSizeLogged) return;
	_interpolateSizeLogged = true;
	console.log("[Panel/PanelSet] Browser supports 'interpolate-size', which will be used for opening and closing.");
}


/** A before-open event detail carrying a promise the open can wait for, so content can arrive late. */
export interface Awaitable {
	/** What the open actually waits on. Use waitUntil() instead. */
	promise: Promise<unknown> | null;
	/** Hold the open until p resolves. Call it as often as you like: the open waits for all of them. Safe to pull out of the detail on its own, since it closes over the detail, not `this`. */
	waitUntil(p: Promise<unknown>): void;
}

/**
 * Gives the detail its waitUntil(), which sets detail.promise and folds several calls together with Promise.all. Setting detail.promise yourself still works.
 */
export function attachWaitUntil(detail: Awaitable): void {
	detail.waitUntil = (p) => {
		detail.promise = detail.promise ? Promise.all([detail.promise, p]) : p;
	};
}

/**
 * Register an async content handler on a CustomEvent. It gets the target element and an AbortSignal.
 * Return a promise and it goes to event.detail.waitUntil(), so the open waits for it, along with any other waitUntil calls.
 * With once:true the handler is skipped after the first load that works, remembered on target.dataset.loaded.
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
