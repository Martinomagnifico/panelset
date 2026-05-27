import '../style/panelset.scss';
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

function trueSiblings(
	item: HTMLElement,
	opts: {
		groupSelector: string;
		scopeSelector?: string;
		itemSelector:  string;
		filter?:       (el: HTMLElement) => boolean;
	}
): HTMLElement[] {
	const { groupSelector, scopeSelector = groupSelector, itemSelector, filter } = opts;

	const belongsToGroup = (el: HTMLElement, group: HTMLElement): boolean => {
		if (el.closest(scopeSelector) !== group) return false;
		const parentItem = el.parentElement?.closest<HTMLElement>(itemSelector);
		return !parentItem || !group.contains(parentItem);
	};

	const group = item.closest<HTMLElement>(groupSelector);
	if (!group || !belongsToGroup(item, group)) return [];

	return [...group.querySelectorAll<HTMLElement>(itemSelector)].filter(sibling =>
		sibling !== item &&
		belongsToGroup(sibling, group) &&
		(filter ? filter(sibling) : true)
	);
}

export class Panel {
	element: HTMLElement;
	config: Required<PanelConfig>;

	private _returnFocusTarget: HTMLElement | null = null;
	private _tempCloseGroup: HTMLElement | null = null;
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
		loadingDelay: 320,
		loadingHeight: 150,
		interruptible: true,
		persist: false,
		deepLink: false,
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
		deepLink:       ['panelDeeplink',       'boolean'],
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
			if (!next) return;
			if (!next.id) next.id = `panel-${++Panel._autoIdCounter}`;
			trigger.setAttribute('aria-controls', next.id);
			trigger.setAttribute('aria-expanded', 'false');
			trigger.removeAttribute('data-panel-trigger');
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
		if (this.config.align !== 'start') element.dataset.panelAlign = this.config.align;

		this._bindTriggers();

		if (this._resolveInitialState()) {
			// URL param or localStorage says open — snap open without animation
			this.element.classList.add('is-open');
			this.element.removeAttribute('inert');
			this._setTriggerState(true);
			// is-restored is present for exactly one paint so CSS can suppress
			// transitions on parent/sibling elements. Double rAF ensures the class
			// survives the first paint before being removed.
			this.element.classList.add('is-restored');
			requestAnimationFrame(() => requestAnimationFrame(() => this.element.classList.remove('is-restored')));
			this._dispatch('panel:opened');
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
		let groupDeepLink = false;
		let el = this.element.parentElement;

		while (el) {
			if (el.hasAttribute('data-panel')) break;
			if (el.hasAttribute('data-panel-group')) {
				groupPersist = el.hasAttribute('data-panel-persist');
				groupDeepLink = el.hasAttribute('data-panel-deeplink');
				break;
			}
			el = el.parentElement;
		}

		const hasPersist = this.config.persist || groupPersist;
		const hasDeepLink = this.config.deepLink || groupDeepLink;

		if (hasPersist) {
			writeStored(`panel:${this.element.id}`, open ? 'open' : 'closed');
		}

		if (hasDeepLink) {
			this._updatePanelParam(open);
		} else if (!open && this._parsePanelParam()) {
			// No deepLink configured: on close, still clean up a stale ?panel= ID
			// left by a snap-open so the URL doesn't keep reopening the panel.
			this._updatePanelParam(false);
		}
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
				if (!this.isOpen || this.element.classList.contains('is-closing')) return;
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

	private _cleanupTempClose() {
		if (!this._tempCloseGroup) return;
		this._tempCloseGroup.style.removeProperty('--ps-tempclose-speed');
		this._tempCloseGroup.style.removeProperty('--ps-tempclose-timing');
		this._tempCloseGroup = null;
	}

	private _closeGroupSiblings() {
		const group = this.element.closest<HTMLElement>('[data-panel-group]');
		const groupClose = group?.hasAttribute('data-panel-close-siblings') ?? false;
		if (!this.config.closeSiblings && !groupClose) return;

		const toClose: HTMLElement[] = group
			? trueSiblings(this.element, {
				groupSelector: '[data-panel-group]',
				itemSelector:  '[data-panel]',
				filter:        el => !!el.panel?.isOpen,
			})
			: Array.from(this.element.parentElement?.children ?? [])
				.filter((el): el is HTMLElement =>
					el instanceof HTMLElement && el !== this.element && !!el.panel?.isOpen
				);

		if (toClose.length && group) {
			group.style.setProperty('--ps-tempclose-speed', 'var(--ps-open-speed)');
			group.style.setProperty('--ps-tempclose-timing', 'var(--ps-open-timing)');
			this._tempCloseGroup = group;
		}

		toClose.forEach(el => {
			el.panel!._returnFocusTarget = null;
			el.panel!.close();
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
		return this.element.classList.contains('is-open') || this.element.classList.contains('is-opening');
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
		// Race content arrival against loadingDelay.
		// If content arrives first, skip Phase 1 entirely — no spinner, no loadingHeight.
		const contentFirst = await Promise.race([
			contentPromise.then(() => true as const),
			new Promise<false>(res => {
				const t = setTimeout(() => res(false), this.config.loadingDelay);
				signal.addEventListener('abort', () => clearTimeout(t));
			}),
		]).catch(() => false as const);

		if (signal.aborted) return;

		if (contentFirst) {
			// Fast path: content ready before loadingDelay — open like a normal panel.
			this._openSync(signal, cssProp, event);
			return;
		}

		// Slow path: loadingDelay elapsed, content not yet ready.
		// Add is-loading BEFORE any forced style flush. If the wrapper is committed
		// at opacity 1 (e.g. panel was previously open) before is-loading is added,
		// then adding is-opening creates a 1→0 opacity transition on the wrapper
		// that makes content visible throughout Phase 1. Adding is-loading first
		// ensures the wrapper is committed at opacity 0, so no transition fires.
		this.element.classList.remove('is-closing');
		this.element.removeAttribute('inert');
		this.element.classList.add('is-loading');

		// Clear stale content so old content doesn't reappear when is-loading is removed.
		this.element.querySelector(':scope > .panel-wrapper')?.replaceChildren();

		// JS already waited loadingDelay, so the spinner should appear immediately.
		this.element.style.setProperty('--ps-loading-delay', '0ms');

		this._setTriggerState(true);
		this._persistState(true);
		this._dispatch('panel:opening');

		const body = findBody(this.element);
		if (body) lockBody(body);

		let openTransition: Promise<void> | undefined;

		if (this.config.transitions) {
			this.element.classList.add('is-opening');
			this.element.style[cssProp] = '0px';
			void getComputedStyle(this.element)[cssProp]; // commit 0px before rAF

			requestAnimationFrame(() => {
				this.element.style[cssProp] = `${this.config.loadingHeight}px`;
			});

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
		}

		if (signal.aborted) return;

		// Phase 2: animate from loadingHeight to content height.
		const currentRect = this.element.getBoundingClientRect();
		const current = cssProp === 'height' ? currentRect.height : currentRect.width;
		this.element.style[cssProp] = '';

		if (this.config.transitions) {
			if (Panel._nativeInterpolateSize) {
				// Inline cleared; @supports block now applies height:auto.
				// Browser transitions from loadingHeight to natural auto size.
				Core.waitForTransition(this.element, cssProp).then(() => {
					if (signal.aborted) return;
					this.element.classList.remove('is-opening');
					this.element.classList.add('is-open');
					this._dispatch('panel:opened');
					this._log('Opened');
					this._handleAutoFocus(event);
				});
			} else {
				// JS fallback: measure natural size, re-lock at loadingHeight, animate.
				// Set to 'auto' before measuring — base CSS gives height:0 so the cleared
				// inline style would return 0 from getBoundingClientRect.
				this.element.style[cssProp] = 'auto';
				const targetRect = this.element.getBoundingClientRect();
				const target = cssProp === 'height' ? targetRect.height : targetRect.width;
				this.element.style[cssProp] = `${current}px`;
				void getComputedStyle(this.element)[cssProp];

				requestAnimationFrame(() => {
					this.element.style[cssProp] = `${target}px`;

					Core.waitForTransition(this.element, cssProp).then(() => {
						if (signal.aborted) return;
						this.element.style[cssProp] = '';
						this.element.classList.remove('is-opening');
						this.element.classList.add('is-open');
						this._dispatch('panel:opened');
						this._log('Opened');
						this._handleAutoFocus(event);
					});
				});
			}
		} else {
			this.element.classList.remove('is-opening');
			this.element.classList.add('is-open');
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
			? this.element.getBoundingClientRect()[cssProp === 'height' ? 'height' : 'width']
			: null;

		this.element.classList.remove('is-closing');
		this.element.removeAttribute('inert');

		const body = findBody(this.element);

		if (this.config.transitions) {
			if (Panel._nativeInterpolateSize) {
				// Native path: lock BEFORE closeGroupSiblings so the layout flush inside
				// sibling close() sees this panel already committed at 0px, not at its
				// natural open height. Without this, the flush overwrites the 0px lock
				// and the 0→auto transition has no delta to animate.
				this.element.classList.add('is-opening');
				this.element.style[cssProp] = reverseStartSize !== null ? `${reverseStartSize}px` : '0px';
				if (body) lockBody(body);
				void getComputedStyle(this.element)[cssProp]; // commit 0px before sibling flush

				this._setTriggerState(true);
				this._persistState(true);
				this._closeGroupSiblings();
				this._dispatch('panel:opening');

				requestAnimationFrame(() => {
					this.element.style[cssProp] = '';
					Core.waitForTransition(this.element, cssProp).then(() => {
						if (signal.aborted) return;
						this.element.classList.remove('is-opening');
						this.element.classList.add('is-open');
						this._dispatch('panel:opened');
						this._cleanupTempClose();
						this._log('Opened');
						this._handleAutoFocus(event);
					});
				});
			} else {
				this._setTriggerState(true);
				this._persistState(true);
				this._closeGroupSiblings();
				this._dispatch('panel:opening');
				// JS fallback: measure natural size, lock at 0 (or reverse start), animate
				// to target px, then clear inline on complete.
				// Set to 'auto' so getBoundingClientRect returns the natural content size.
				// The base CSS gives height:0, so without this the measured target would be 0.
				this.element.style[cssProp] = 'auto';

				const rect   = this.element.getBoundingClientRect();
				const target = cssProp === 'height' ? rect.height : rect.width;

				this.element.style[cssProp] = reverseStartSize !== null ? `${reverseStartSize}px` : '0px';
				this.element.classList.add('is-opening');
				if (body) lockBody(body);
				// Force a flush so Firefox commits the locked state before the rAF.
				void getComputedStyle(this.element)[cssProp];

				requestAnimationFrame(() => {
					this.element.style[cssProp] = `${target}px`;
					Core.waitForTransition(this.element, cssProp).then(() => {
						if (signal.aborted) return;
						this.element.style[cssProp] = '';
						this.element.classList.remove('is-opening');
						this.element.classList.add('is-open');
						this._dispatch('panel:opened');
						this._cleanupTempClose();
						this._log('Opened');
						this._handleAutoFocus(event);
					});
				});
			}
		} else {
			this._setTriggerState(true);
			this._persistState(true);
			this._closeGroupSiblings();
			this._dispatch('panel:opening');
			this.element.classList.add('is-open');
			this._dispatch('panel:opened');
			this._cleanupTempClose();
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
			this.element.classList.remove('is-closing', 'is-open', 'is-opening');
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

		const rect    = this.element.getBoundingClientRect();
		const current = prop === 'height' ? rect.height : rect.width;
		this.element.style[prop] = `${current}px`;
		this.element.classList.remove('is-opening', 'is-open');
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

		this.element.classList.remove('is-opening', 'is-closing', 'is-loading', 'is-open');
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
