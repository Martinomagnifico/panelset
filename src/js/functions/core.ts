/**
 * The animation engine behind the height and width transitions. One per element.
 * start() cancels the cycle before it and returns a new AbortSignal. Give that to fetch(), and cancelling the animation cancels the request too.
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

	// Races content against loadingDelay. true means it arrived inside the window, so the caller shows no loading state at all. A rejection loses the race: the caller takes its loading path and awaits the promise again, where its own catch deals with the error.
	static raceContent(promise: Promise<unknown>, delay: number, signal: AbortSignal): Promise<boolean> {
		let timer: ReturnType<typeof setTimeout>;
		const onAbort = () => clearTimeout(timer);

		return Promise.race([
			promise.then(() => true as const),
			new Promise<false>(resolve => {
				timer = setTimeout(() => resolve(false), delay);
				signal.addEventListener('abort', onAbort, { once: true });
			}),
		])
		.catch(() => false as const)
		.finally(() => {
			clearTimeout(timer);
			signal.removeEventListener('abort', onAbort);
		});
	}

	// Always resolves. If transitionend never fires it falls back to a setTimeout, which happens when a transition is interrupted and nothing moves.
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
