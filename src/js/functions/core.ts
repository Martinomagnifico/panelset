/**
 * Core animation engine for dimension-growth transitions.
 *
 * Use one Core instance per animated element. Calling start() aborts any
 * in-progress animation and returns a fresh AbortSignal — the same signal can
 * be passed directly to fetch() so that navigating away automatically cancels
 * both the animation and any in-flight async work.
 */
export class Core {
	private _controller = new AbortController();

	/**
	 * The AbortSignal for the current animation.
	 * Pass to fetch() or other async operations for unified cancellation.
	 */
	get signal(): AbortSignal {
		return this._controller.signal;
	}

	/**
	 * Start a new animation cycle: aborts the previous one and returns a
	 * fresh AbortSignal. Call this at the start of every open / close.
	 */
	start(): AbortSignal {
		this._controller.abort();
		this._controller = new AbortController();
		return this._controller.signal;
	}

	/**
	 * Wait for the CSS transition on el to end. Always resolves — includes a
	 * setTimeout fallback for cases where transitionend never fires (e.g. an
	 * interrupted 0 to 0 transition where no actual change occurs).
	 */
	static waitForTransition(el: HTMLElement, propertyName?: string): Promise<void> {
		return new Promise(resolve => {
			const s = getComputedStyle(el);
			const total = (parseFloat(s.transitionDuration) || 0)
			            + (parseFloat(s.transitionDelay)    || 0);
			if (total === 0) return resolve();

			let settled = false;
			const finish = () => {
				if (settled) return;
				settled = true;
				el.removeEventListener('transitionend', handler);
				resolve();
			};
			const handler = (e: TransitionEvent) => {
				if (e.target !== el) return;
				if (propertyName && e.propertyName !== propertyName) return;
				finish();
			};
			el.addEventListener('transitionend', handler);
			// Fallback: resolve after expected duration + small buffer in case
			// transitionend never fires (interrupted or zero-delta transition).
			setTimeout(finish, (total + 0.05) * 1000);
		});
	}

}
