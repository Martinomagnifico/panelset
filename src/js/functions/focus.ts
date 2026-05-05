/**
 * The autoFocus mode. Pass to autoFocus() after opening a panel.
 * - true        : focus the panel element itself
 * - 'heading'   : focus the first heading (h1–h6)
 * - 'first'     : focus the first focusable element
 * - 'input'     : focus the first form field (bypasses keyboard-only check)
 * - function    : custom handler, called with the panel element
 */
export type AutoFocusMode =
	| boolean
	| 'heading'
	| 'first'
	| 'input'
	| ((el: HTMLElement) => void);

/**
 * Move focus into a panel after it opens.
 *
 * Skips focus when the triggering event is a mouse/touch click (not
 * keyboard), except for 'input' mode which always focuses.
 */
export function autoFocus(el: HTMLElement, mode: AutoFocusMode, event?: Event): void {
	if (!mode) return;

	if (mode !== 'input' && event) {
		const isKeyboard =
			event.type.startsWith('key') ||
			(event instanceof MouseEvent && event.detail === 0);
		if (!isKeyboard) return;
	}

	const focus = (target: HTMLElement) => {
		setTimeout(() => target.focus(), 100);
	};

	if (mode === true) {
		if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
		focus(el);
	} else if (mode === 'heading') {
		const heading = el.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6');
		if (heading) {
			if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
			focus(heading);
		}
	} else if (mode === 'first') {
		const focusable = el.querySelector<HTMLElement>(
			'a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])'
		);
		if (focusable) focus(focusable);
	} else if (mode === 'input') {
		const input = el.querySelector<HTMLElement>(
			'input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled])'
		);
		if (input) focus(input);
	} else if (typeof mode === 'function') {
		setTimeout(() => (mode as (el: HTMLElement) => void)(el), 100);
	}
}
