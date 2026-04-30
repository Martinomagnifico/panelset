/**
 * Pinning elements (for 'push' panels)
 */


export const findBody = (element: HTMLElement): HTMLElement | null => {
	const parent = element.parentElement;
	if (!parent?.querySelector('[data-panel-body]')) return null;

	return Array.from(parent.children).find(
		(el): el is HTMLElement =>
			el instanceof HTMLElement && el.hasAttribute('data-panel-body')
	) ?? null;
};


export const lockBody = (body: HTMLElement): void => {
	const pins = Array.from(body.querySelectorAll<HTMLElement>('[data-panel-pin]'));
	if (!pins.length) return;

	// Measure everything before touching any styles — avoids layout thrashing.
	const snapshots = pins.map(el => ({
		el,
		pin: el.dataset.panelPin as 'start' | 'end',
		w: el.offsetWidth,
	}));

	snapshots.forEach(({ el, pin, w }) => {
		el.style.boxSizing = 'border-box';
		el.style.width = `${w}px`;
		if (pin === 'end') {
			el.style.marginLeft = `calc(100% - ${w}px)`;
		}
	});
};


export const unlockBody = (body: HTMLElement): void => {
	body.querySelectorAll<HTMLElement>('[data-panel-pin]').forEach(el => {
		el.style.boxSizing = '';
		el.style.width = '';
		el.style.marginLeft = '';
	});
};