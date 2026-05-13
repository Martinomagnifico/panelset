import '../style/panel.scss';
import { Core } from './functions/core';
import { autoFocus } from './functions/focus';
import { readPanelParam, writePanelParam, readStored, writeStored } from './functions/persist';
import { findBody, lockBody, unlockBody } from './functions/pinning';

import type { PanelConfig, BeforeOpenEventDetail, PanelEventDetail, AsyncOpenHandler } from './panel.types';
import { parseDataAttrs, type AttrMap } from './functions/config';
import { log, logInterpolateSizeOnce, registerBeforeOpenHandler } from './functions/utils';

declare global {
	interface HTMLElement {
		panel?: Panel;
	}
}

export class Panel {
	element: HTMLElement;
	config: Required<PanelConfig>;

	private _returnFocusTarget: HTMLElement | null = null;
	private _anim = new Core();
	private _listenerController = new AbortController();
	private _activating = false;

	static defaults: Required<PanelConfig> = {
		axis: 'vertical',
		align: 'start',
		closeOnResize: false,
		transitions: true,
		autoFocus: false,
		returnFocus: true,
		closeSiblings: false,
		loadingDelay: 300,
		loadingHeight: 80,
		interruptible: true,
		persist: false,
		debug: false,
	};

	static readonly attrs: AttrMap<PanelConfig> = {
		axis:          ['panelAxis',          'string'],
		align:         ['panelAlign',         'string'],
		autoFocus:     ['panelAutoFocus',      'string'],
		closeOnResize: ['panelCloseOnResize',  'boolean'],
		transitions:   ['panelTransitions',   'boolean'],
		returnFocus:   ['panelReturnFocus',   'boolean'],
		closeSiblings: ['panelCloseSiblings', 'boolean'],
		loadingDelay:  ['panelLoadingDelay',  'number'],
		loadingHeight:  ['panelLoadingHeight',  'number'],
		interruptible:  ['panelInterruptible',  'boolean'],
		persist:        ['panelPersist',        'boolean'],
		debug:          ['panelDebug',          'boolean'],
	};

	// True when the browser supports interpolate-size: allow-keywords.
	// When set, CSS animates height/width 0 to/from auto natively and the JS
	// measure-animate cycle is skipped (open/close just toggle state classes).
	private static readonly _nativeInterpolateSize =
		typeof CSS !== 'undefined' && CSS.supports('interpolate-size: allow-keywords');

	private static _autoIdCounter = 0;

	static init(selectorOrOptions: string | PanelConfig = '[data-panel]', options: PanelConfig = {}): Panel[] {
		let selector: string;
		let config: PanelConfig;
		if (typeof selectorOrOptions === 'string') {
			selector = selectorOrOptions;
			config = options;
		} else {
			config = selectorOrOptions;
			selector = '[data-panel]';
		}

		// Wire up implicit trigger/panel pairs: a [data-panel-trigger] button
		// next to a sibling [data-panel] with no ID gets an auto-assigned stable
		// ID, and aria-controls / aria-expanded are set on the trigger.
		// Scans forward first, then backward, to handle both panel-after-trigger
		// and panel-before-trigger layouts.

		document.querySelectorAll<HTMLElement>('[data-panel-trigger]').forEach(trigger => {
			let el = trigger.nextElementSibling as HTMLElement | null;
			while (el && !el.hasAttribute('data-panel')) el = el.nextElementSibling as HTMLElement | null;
			if (!el) {
				el = trigger.previousElementSibling as HTMLElement | null;
				while (el && !el.hasAttribute('data-panel')) el = el.previousElementSibling as HTMLElement | null;
			}
			const next = el;
			if (!next || next.id) return;
			next.id = `panel-${++Panel._autoIdCounter}`;
			trigger.setAttribute('aria-controls', next.id);
			trigger.setAttribute('aria-expanded', 'false');
		});

		return Array.from(document.querySelectorAll<HTMLElement>(selector))
			.filter(el => !el.panel)
			.filter(el => !el.dataset.panel || el.dataset.panel === 'data-panel') // skip data-panel="id" trigger buttons; Panel containers have no value (or Pug's boolean "data-panel")
			.map(el => new Panel(el, config));
	}

	constructor(elementOrSelector: HTMLElement | string, options: PanelConfig = {}) {
		const element = typeof elementOrSelector === 'string'
			? document.querySelector<HTMLElement>(elementOrSelector)
			: elementOrSelector;
		if (!element) throw new Error(`Panel: No element found for selector "${elementOrSelector}"`);
		this.element = element;
		element.panel = this;

		if (!element.querySelector(':scope > .panel-wrapper')) {
			const wrapper = document.createElement('div');
			wrapper.className = 'panel-wrapper';
			wrapper.append(...Array.from(element.childNodes));
			element.appendChild(wrapper);
		}

		const dataConfig = parseDataAttrs<PanelConfig>(element.dataset, Panel.attrs);
		this.config = { ...Panel.defaults, ...dataConfig, ...options };

		if (this.config.axis === 'horizontal') element.dataset.panelAxis = 'horizontal';
		element.dataset.panelAlign = this.config.align;

		this._bindTriggers();

		if (this._resolveInitialState()) {
			// URL param or localStorage says open — snap open without animation
			this.element.classList.remove('is-closed');
			this.element.removeAttribute('inert');
			this._setTriggerState(true);
		} else if (!this.isOpen) {
			this.element.setAttribute('inert', '');
		}

		if (Panel._nativeInterpolateSize) logInterpolateSizeOnce(this.config.debug);
		this._log('Initialized');
	}

	private _log(msg: string) { log('Panel', this.element, this.config.debug, msg); }

	// URL param + localStorage helpers 

	private _parsePanelParam = (): boolean => {
		const { id } = this.element;
		if (!id) return false;
		return readPanelParam().includes(id);
	};

	private _updatePanelParam = (open: boolean): void => {
		const { id } = this.element;
		if (!id) return;
		const current = readPanelParam();
		const next = open
			? [...new Set([...current, id])]
			: current.filter(i => i !== id);
		writePanelParam(next);
	};

	private _persistState = (open: boolean): void => {
		if (!this.element.id) return;

		let groupPersist = false;
		let el = this.element.parentElement;

		while (el) {
			if (el.hasAttribute('data-panel')) break;
			if (el.hasAttribute('data-panel-group')) {
				groupPersist = el.hasAttribute('data-panel-persist');
				break;
			}
			el = el.parentElement;
		}

		if (!this.config.persist && !groupPersist) return;

		writeStored(`panel:${this.element.id}`, open ? 'open' : 'closed');
		this._updatePanelParam(open);
	};

	private _resolveInitialState = (): boolean => {
		if (this._parsePanelParam()) return true;
		const { id } = this.element;
		return !!id && readStored(`panel:${id}`) === 'open';
	};

	private _cssProp = (): 'height' | 'width' =>
		this.config.axis === 'horizontal' ? 'width' : 'height';


	private _bindTriggers() {
		const id = this.element.id;
		if (!id) return;
		const { signal } = this._listenerController;

		document.querySelectorAll<HTMLElement>(`[aria-controls="${id}"]`).forEach(trigger => {
			trigger.addEventListener('click', e => {
				this._returnFocusTarget = trigger;
				this.toggle(e);
			}, { signal });
		});

		this.element.querySelectorAll<HTMLElement>('[data-panel-close]')
			.forEach(btn => {
				if (btn.closest('[data-panel]') !== this.element) return;
				btn.addEventListener('click', () => this.close(), { signal });
			});

		if (this.config.closeOnResize) {
			window.addEventListener('resize', () => {
				if (!this.isOpen) return;
				const body = findBody(this.element);
				if (body) unlockBody(body);
				this.close();
			}, { signal });
		}
	}

	private _setTriggerState(open: boolean) {
		const id = this.element.id;
		if (!id) return;
		document.querySelectorAll(`[aria-controls="${id}"]`).forEach(t =>
			t.setAttribute('aria-expanded', String(open))
		);
	}

	private _closeGroupSiblings() {
		const group = this.element.closest('[data-panel-group]');
		const groupClose = group?.hasAttribute('data-panel-close-siblings') ?? false;
		if (!this.config.closeSiblings && !groupClose) return;
		const scope = group ?? this.element.parentElement;
		if (!scope) return;
		// Use el.panel as the definitive filter — set by Panel's constructor on
		// every instance regardless of element tag or data-attributes.
		// With a group: search all descendants, skip nested-group panels.
		// Without a group: limit to direct children.
		const candidates = group
			? scope.querySelectorAll<HTMLElement>('*')
			: (scope.children as HTMLCollectionOf<HTMLElement>);
		Array.from(candidates).forEach(el => {
			if (el === this.element) return;
			if (group && el.closest('[data-panel-group]') !== scope) return;
			if (el.panel?.isOpen) {
				el.panel._returnFocusTarget = null;
				el.panel.close();
			}
		});
	}

	private _handleAutoFocus(event?: Event) {
		if (!this.config.autoFocus) return;
		autoFocus(this.element, this.config.autoFocus, event);
	}

	private _dispatch(name: string) {
		if (name === 'panel:opened' || name === 'panel:closed') this._activating = false;
		const detail: PanelEventDetail = { trigger: this._returnFocusTarget };
		this.element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
	}

	// Public API

	get isOpen(): boolean {
		return !this.element.classList.contains('is-closed');
	}



	// open

	async open(event?: Event) {
		if (this.isOpen && !this.element.classList.contains('is-closing')) return;
		if (this.config.interruptible === false && this._activating) return;

		this._activating = true;
		const signal  = this._anim.start();
		const cssProp = this._cssProp();

		const beforeOpenDetail: BeforeOpenEventDetail = {
			signal,
			promise: null,
			trigger: this._returnFocusTarget
		};

		this.element.dispatchEvent(
			new CustomEvent('panel:beforeopen', { detail: beforeOpenDetail, bubbles: true })
		);

		if (beforeOpenDetail.promise) {
			await this._openAsync(signal, cssProp, beforeOpenDetail.promise, event);
		} else {
			this._openSync(signal, cssProp, event);
		}
	}


	// async content path

	private async _openAsync(
		signal:         AbortSignal,
		cssProp:        'height' | 'width',
		contentPromise: Promise<void>,
		event?:         Event
	) {
		this.element.classList.remove('is-closed', 'is-closing');
		this.element.removeAttribute('inert');

		// For push/inline panels (position: static), temporarily set relative so
		// the loading spinner's ::after (position: absolute) has an anchor.
		const needsPositionLock = getComputedStyle(this.element).position === 'static';
		if (needsPositionLock) this.element.style.position = 'relative';

		this._setTriggerState(true);
		this._persistState(true);
		this._dispatch('panel:opening');

		const body = findBody(this.element);
		if (body) lockBody(body);

		// Add is-loading immediately — wrapper starts at opacity:0 so no flash.
		// The spinner itself is delayed via CSS --ps-loading-delay so it only appears
		// for slow loads, without any JS timer involved.
		this.element.style.setProperty('--ps-loading-delay', `${this.config.loadingDelay}ms`);
		this.element.classList.add('is-loading');

		let openTransition: Promise<void> | undefined;

		if (this.config.transitions) {
			this.element.classList.add('is-opening');
			this.element.style[cssProp] = '0px';

			requestAnimationFrame(() => {
				this.element.style[cssProp] = `${this.config.loadingHeight}px`;
			});

			// Wait specifically for the dimension transition so the spinner's
			// opacity transitionend doesn't resolve this early.
			openTransition = Core.waitForTransition(this.element, cssProp);
		} else {
			this.element.style[cssProp] = `${this.config.loadingHeight}px`;
		}

		try {
			await Promise.all([contentPromise, openTransition].filter(Boolean) as Promise<void>[]);
		} catch {
			// AbortError or content error — fall through to signal check below
		} finally {
			this.element.classList.remove('is-loading');
			this.element.style.removeProperty('--ps-loading-delay');
			if (needsPositionLock) this.element.style.position = '';
		}

		if (signal.aborted) return;

		// Measure natural size now that content has landed. Clear the loading-height
		// inline style so the CSS value takes over; for the JS fallback we re-lock
		// at the loading height immediately after measuring the target.
		const current = cssProp === 'height' ? this.element.offsetHeight : this.element.offsetWidth;
		this.element.style[cssProp] = '';

		if (this.config.transitions) {
			if (Panel._nativeInterpolateSize) {
				// Inline style cleared; is-opening's height: auto (from the
				// @supports block) now applies. The browser transitions from the
				// loading height to the element's natural auto size.
				Core.waitForTransition(this.element, cssProp).then(() => {
					if (signal.aborted) return;
					this.element.classList.remove('is-opening');
					this._dispatch('panel:opened');
					this._log('Opened');
					this._handleAutoFocus(event);
				});
			} else {
				// JS fallback: measure auto size, re-lock at loading height, then
				// animate to the target in rAF.
				const target = cssProp === 'height' ? this.element.offsetHeight : this.element.offsetWidth;
				this.element.style[cssProp] = `${current}px`;

				requestAnimationFrame(() => {
					this.element.style[cssProp] = `${target}px`;

					Core.waitForTransition(this.element, cssProp).then(() => {
						if (signal.aborted) return;
						this.element.style[cssProp] = '';
						this.element.classList.remove('is-opening');
						this._dispatch('panel:opened');
						this._log('Opened');
						this._handleAutoFocus(event);
					});
				});
			}
		} else {
			this.element.classList.remove('is-opening');
			this._dispatch('panel:opened');
			this._log('Opened');
			this._handleAutoFocus(event);
		}
	}


	// sync path

	private _openSync(
		signal:  AbortSignal,
		cssProp: 'height' | 'width',
		event?:  Event
	) {
		const isReversingClose = this.element.classList.contains('is-closing');
		const reverseStartSize = isReversingClose
			? (cssProp === 'height' ? this.element.offsetHeight : this.element.offsetWidth)
			: null;

		// Measure before touching classes. scrollHeight reads natural size without
		// committing it as the CSS "from" state. offsetHeight after the class swap
		// would lock the element at full height — Firefox sees height → height
		// and skips the transition.
		const cs0        = getComputedStyle(this.element);
		const scrollSize = cssProp === 'height' ? this.element.scrollHeight : this.element.scrollWidth;
		const borderSize = cssProp === 'height'
			? (parseFloat(cs0.borderTopWidth)  || 0) + (parseFloat(cs0.borderBottomWidth) || 0)
			: (parseFloat(cs0.borderLeftWidth) || 0) + (parseFloat(cs0.borderRightWidth)  || 0);
		const target = scrollSize + borderSize;

		this.element.classList.remove('is-closed', 'is-closing');
		this.element.removeAttribute('inert');

		this._setTriggerState(true);
		this._persistState(true);
		this._closeGroupSiblings();
		this._dispatch('panel:opening');

		const body = findBody(this.element);

		if (this.config.transitions) {
			this.element.classList.add('is-opening');
			this.element.style[cssProp] = reverseStartSize !== null ? `${reverseStartSize}px` : '0px';
			if (body) lockBody(body);

			requestAnimationFrame(() => {
				this.element.style[cssProp] = `${target}px`;
				void getComputedStyle(this.element)[cssProp];
				Core.waitForTransition(this.element, cssProp).then(() => {
					if (signal.aborted) return;
					this.element.style[cssProp] = '';
					this.element.classList.remove('is-opening');
					this._dispatch('panel:opened');
					this._log('Opened');
					this._handleAutoFocus(event);
				});
			});
		} else {
			this._dispatch('panel:opened');
			this._log('Opened');
			this._handleAutoFocus(event);
		}
	}


	/**
	 * Register a handler for async content loading before the panel opens.
	 * The handler receives the panel element and an AbortSignal.
	 * If it returns a Promise, the panel waits for it before animating open.
	 */
	onBeforeOpen(handler: AsyncOpenHandler, options: { once?: boolean } = {}): void {
		registerBeforeOpenHandler<BeforeOpenEventDetail>(
			this.element,
			'panel:beforeopen',
			() => this.element,
			handler,
			options
		);
	}

	close(event?: Event) {
		if (!this.isOpen) return;
		if (this.config.interruptible === false && this._activating) return;

		this._activating = true;
		this.element.setAttribute('inert', '');
		this._setTriggerState(false);

		const prop = this._cssProp();
		const body = findBody(this.element);
		const signal = this._anim.start();

		this._dispatch('panel:closing');

		const finish = () => {
			this.element.classList.remove('is-closing');
			this.element.classList.add('is-closed');
			this.element.style[prop] = '';
			if (body) unlockBody(body);
			this._persistState(false);
			this._dispatch('panel:closed');
			this._log('Closed');
			const byPointer = event instanceof PointerEvent && event.pointerType !== '';
			if (this.config.returnFocus && this._returnFocusTarget && !byPointer) {
				this._returnFocusTarget.focus();
			}
		};

		if (!this.config.transitions) {
			finish();
			return;
		}

		const current = prop === 'height' ? this.element.offsetHeight : this.element.offsetWidth;
		this.element.style[prop] = `${current}px`;
		this.element.classList.add('is-closing');
		// Force a flush so Firefox sees { is-closing, height: Npx } as a committed
		// state. Without it the lock is overwritten in the rAF and Firefox sees
		// auto → 0px in one step — non-animatable, so it jumps.
		void getComputedStyle(this.element)[prop];
		requestAnimationFrame(() => {
			this.element.style[prop] = '0px';
			Core.waitForTransition(this.element, prop).then(() => {
				if (signal.aborted) return;
				finish();
			});
		});
	}

	toggle(event?: Event) {
		if (this.element.classList.contains('is-closing')) {
			this.open(event); // reverse: re-open from mid-close
		} else if (this.isOpen) {
			this.close(event);
		} else {
			if (event?.target) {
				this._returnFocusTarget =
					(event.target as HTMLElement).closest('button, a') as HTMLElement
					?? event.target as HTMLElement;
			}
			this.open(event);
		}
	}

	/**
	 * Tear down this instance. Removes listeners, resets element state, and
	 * clears element.panel so Panel.init() can re-bind it.
	 */
	destroy() {
		this._anim.start(); // pending .then() callbacks check signal.aborted
		this._listenerController.abort();

		this.element.classList.remove('is-opening', 'is-closing', 'is-loading');
		this.element.classList.add('is-closed');
		this.element.style[this._cssProp()] = '';
		this.element.setAttribute('inert', '');

		this._setTriggerState(false);
		const body = findBody(this.element);
		if (body) unlockBody(body);

		delete this.element.panel;
		this._log('Destroyed');
	}
}

export default Panel;
