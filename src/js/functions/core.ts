/**
 * Animation engine for dimension transitions. One instance per element.
 * start() aborts the previous cycle and returns a fresh AbortSignal.
 * Pass it to fetch() and cancelling the animation cancels the request too.
 */

export class Core {
	private _controller = new AbortController();

	get signal(): AbortSignal {
		return this._controller.signal;
	}

	start(): AbortSignal {
		this._controller.abort();
		this._controller = new AbortController();
		return this._controller.signal;
	}

	// Always resolves. Falls back to setTimeout if transitionend never fires —
	// e.g. an interrupted zero-delta transition where nothing actually moves.
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
			setTimeout(finish, (total + 0.05) * 1000);
		});
	}
}
