/**
 * Shared debug logger. Both Panel and PanelSet use this pattern.
 */
export function log(prefix: string, element: HTMLElement, debug: boolean, message: string): void {
	if (!debug) return;
	console.log(`[${prefix}] "${element.id || 'no id'}" -`, message);
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


/**
 * Register an async content handler on a CustomEvent.
 * The handler receives the target element and an AbortSignal.
 * If it returns a Promise, that promise is attached to event.detail.promise
 * so the consuming code can await it.
 * Pass once:true to skip the handler after the first successful load
 * (tracked via target.dataset.loaded).
 */
export function registerBeforeOpenHandler<D extends { signal: AbortSignal; promise: Promise<void> | null }>(
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
			event.detail.promise = result.then(() => {
				if (once) target.dataset.loaded = 'true';
			});
		}
	});
}
