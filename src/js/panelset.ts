import '../style/panelset.scss';
import { Core } from './functions/core';
import { autoFocus } from './functions/focus';
import type { AutoFocusMode } from './functions/focus';
import { readPanelParam, writePanelParam, readStored, writeStored } from './functions/persist';


import type { PanelSetConfig, ReadyEventDetail, BeforeActivateEventDetail, BeforeOpenEventDetail, ActivationEventDetail, ActivationAbortedEventDetail, HandlerOptions, ShowOptions, AsyncContentHandler } from './panelset.types';
import { parseDataAttrs, type AttrMap } from './functions/config';
import { log, logInterpolateSizeOnce, registerBeforeOpenHandler } from './functions/utils';

declare global {
	interface HTMLElement {
		panelSet?: PanelSet;
	}
}

/*
 * Why JavaScript is always required — even when CSS enhancements are active
 * -------------------------------------------------------------------------
 * CSS handles *presentation*: transitions, opacity fades, and (where supported)
 * native interpolate-size animations. JS owns *state*, *semantics*, and
 * *behaviour* — these are complementary layers, not competing ones.
 *
 * Specifically, JS remains responsible for:
 *
 *  - State classes: toggling active, is-transitioning, is-loading, is-open,
 *    is-opening, is-closing on panels and the container. Closable sets are
 *    closed by default; the .is-open class (absent by default) marks open.
 *  - Trigger wiring: binding click handlers on [aria-controls] buttons/tabs
 *    and delegating to show().
 *  - ARIA: managing aria-expanded, aria-controls, aria-selected, and
 *    aria-hidden so assistive technology tracks the active panel correctly.
 *  - Keyboard navigation: arrow keys, Home/End within a tablist, Tab/Shift-Tab
 *    to move between tab and panel.
 *  - Focus management: moving focus into the new panel on activation (autoFocus)
 *    and returning it to the trigger on close (returnFocus).
 *  - Lifecycle events: dispatching ps:ready, ps:beforeactivate (cancelable),
 *    ps:beforeopen, ps:activationstart, ps:activationcomplete, and
 *    ps:activationaborted for userland hooks.
 *  - prefers-reduced-motion: CSS variables gate the CSS transitions, but JS
 *    must also check the media query before calling startViewTransition() —
 *    the View Transitions API does not consult prefers-reduced-motion itself.
 *  - Async content: awaiting ps:beforeopen promises, showing the loading
 *    spinner, and sequencing the reveal once content has settled.
 *  - Persist / deep-link: reading and writing the ?panel= URL param and
 *    localStorage so panel state survives navigation.
 */
export class PanelSet {
	// Default configuration
	static defaults: Required<Omit<PanelSetConfig, 'selector'>> = {
		align: 'start',
		transitions: true,
		levels: false,
		loop: false,
		closable: false,
		closeOnTab: false,
		loadingHeight: 150,
		loadingDelay: 320,
		returnFocus: false,
		autoFocus: false,
		persist: false,
		deepLink: false,
		interruptible: true,
		manageTriggers: true,
		debug: false
	};

	// Instance properties
	element!: HTMLElement;
	config!: Required<Omit<PanelSetConfig, 'selector'>>;
	panels!: HTMLElement[];
	activePanel!: HTMLElement;
	panelWrapper!: HTMLElement;
	pendingPanel!: HTMLElement;
	/** True once an async content handler has been registered via onBeforeOpen(). */
	hasAsyncContent: boolean = false;

	private _animShow    = new Core(); // panel switching + async content
	private _animOpenClose = new Core(); // container open/close
	private _isLoadingAsync: boolean = false;
	private _activating: boolean = false;
	private _switchDirection: 'levelup' | 'leveldown' | null = null;
	private _returnFocusTarget: HTMLElement | null = null;
	private _heightObserver: ResizeObserver | null = null;

	private static readonly _nativeInterpolateSize =
		typeof CSS !== 'undefined' && CSS.supports('interpolate-size: allow-keywords');

	static readonly attrs: AttrMap<PanelSetConfig> = {
		align:         ['panelsetAlign',  'string'],
		transitions:   ['transitions',   'json'],
		levels:        ['psLevels',      'boolean'],
		loop:          ['psLoop',        'boolean'],
		closable:      ['closable',      'boolean'],
		closeOnTab:    ['closeOnTab',    'boolean'],
		loadingHeight: ['loadingHeight', 'number'],
		loadingDelay:  ['loadingDelay',  'number'],
		autoFocus:      ['autoFocus',      'string'],
		returnFocus:    ['returnFocus',    'boolean'],
		persist:        ['panelPersist',   'boolean'],
		deepLink:       ['panelDeeplink',  'boolean'],
		interruptible:  ['interruptible',  'boolean'],
		manageTriggers: ['manageTriggers', 'boolean'],
		debug:          ['debug',          'boolean'],
	};

	/**
	 * Initialize PanelSet instances
	 * @param selectorOrOptions - CSS selector string or config object
	 * @param options - Additional config options (when first param is selector)
	 * @returns Array of PanelSet instances
	 */
	static init(selectorOrOptions: string | PanelSetConfig = {}, options: PanelSetConfig = {}): PanelSet[] {
		// Handle different call signatures
		let selector: string;
		let config: PanelSetConfig;

		if (typeof selectorOrOptions === 'string') {
			// init('#demo') or init('#demo', {debug: true})
			selector = selectorOrOptions;
			config = options;
		} else {
			// init() or init({selector: '#demo', debug: true})
			config = selectorOrOptions;
			selector = config.selector || '[data-panelset]';
		}

		const elements = document.querySelectorAll<HTMLElement>(selector);
		const instances: PanelSet[] = [];

		elements.forEach(el => {

			try {
				PanelSet._validateElement(el);
			} catch (error) {
				console.error((error as Error).message);
				return;
			}

			// Skip if already initialized
			if (el.panelSet) {
				instances.push(el.panelSet);
				return;
			}

			const instance = new PanelSet(el, config);
			instances.push(instance);
		});

		return instances;
	}

	constructor(elementOrSelector: HTMLElement | string, options: PanelSetConfig = {}) {
		// Handle both element and selector
		let element: HTMLElement | null;
		if (typeof elementOrSelector === 'string') {
			element = document.querySelector<HTMLElement>(elementOrSelector);
			if (!element) {
				throw new Error(`PanelSet: No element found for selector "${elementOrSelector}"`);
			}
		} else {
			element = elementOrSelector;
		}

		this.element = element;

		// Validate element
		PanelSet._validateElement(element);

		// Check if already initialized
		if (element.panelSet) {
			console.warn('PanelSet: already initialized');
			return element.panelSet!;
		}

		// Store instance on element
		element.panelSet = this;

		// Precedence: defaults < init() options < per-element data-attributes.
		// The attribute is the most specific signal, so it wins — this lets an
		// element opt out of a global flag, e.g. data-panel-persist="false"
		// overriding PanelSet.init({ persist: true }).
		const dataConfig = parseDataAttrs<PanelSetConfig>(element.dataset, PanelSet.attrs);
		this.config = { ...PanelSet.defaults, ...options, ...dataConfig } as Required<Omit<PanelSetConfig, 'selector'>>;

		// Only this set's own panels (a nested PanelSet/Panel would otherwise have
		// its panels claimed by the outer instance). See _collectPanels.
		this.panels = this._collectPanels();

		if (this.panels.length === 0) {
			console.error('PanelSet: no [role=tabpanel] panels found', element);
			// Set safe defaults and bail
			this.panels = [];
			this.activePanel = null as any;
			this.panelWrapper = null as any;
			this.pendingPanel = null as any;
			return;
		}


		const resolvedId = this._resolveInitialPanel();
		this.activePanel =
			(resolvedId ? this.panels.find(p => p.id === resolvedId) : null)
			?? this.panels.find(p => p.classList.contains('active'))
			?? this.panels[0];
		// Direct-child wrapper only — a descendant query could return a nested
		// component's wrapper.
		this.panelWrapper =
			this.element.querySelector<HTMLElement>(':scope > .panel-wrapper') || this._autoWrapPanels();

		this.pendingPanel = this.activePanel;




		// 'start' is the default (no CSS targets it), so only stamp the attribute
		// for non-default alignments — mirrors Panel and keeps the DOM clean.
		if (this.config.align !== 'start') this.element.dataset.panelsetAlign = this.config.align;

		// this.element.setAttribute('data-panelset-ready', ''); // For styling (turning this off for now)

		// Closable sets are closed by default; only an explicit .is-open opens them.
		// A closed set is inert until opened.
		if (this.config.closable && !this.element.classList.contains('is-open')) {
			this.element.setAttribute('inert', '');
		}

		if (PanelSet._nativeInterpolateSize) logInterpolateSizeOnce(this.config.debug);
		this._log(`Initialized (${this.panels.length} panels)`);
		this._dispatch<ReadyEventDetail>('ps:ready', { container: this.element, instance: this });

		this._internalInit();

		this._observeTrackHeight();

	}

	// Re-measure the tallest panel whenever the tracking parent's WIDTH changes.
	// A ResizeObserver reacts to any layout change (window, flex, container
	// queries), not just window resize, and updates promptly instead of after a
	// debounce — so --ps-max-height stays in step with the current width. We
	// guard on width because our own height writes would otherwise re-trigger it.
	private _observeTrackHeight(): void {
		const trackingParent = this.element.closest<HTMLElement>('[data-panelset-trackheight]');
		if (!trackingParent || typeof ResizeObserver === 'undefined') return;

		let lastWidth = trackingParent.clientWidth;
		let rafId = 0;
		this._heightObserver = new ResizeObserver(() => {
			const width = trackingParent.clientWidth;
			if (width === lastWidth) return;
			lastWidth = width;
			cancelAnimationFrame(rafId);
			rafId = requestAnimationFrame(() => this._updateHighestPanel());
		});
		this._heightObserver.observe(trackingParent);
	}

	// Debug logging helper
	private _log(message: string): void { log('PanelSet', this.element, this.config.debug, message); }

	// Closed = a closable set without the .is-open class (and not mid-open).
	// Non-closable tabsets are conceptually always open, so never "closed".
	private get _isClosed(): boolean {
		return this.config.closable
			&& !this.element.classList.contains('is-open')
			&& !this.element.classList.contains('is-opening');
	}

	// URL param + localStorage helpers

	private _parsePanelParam = (): string | null => {
		const ids = readPanelParam();
		return this.panels.find(p => p.id && ids.includes(p.id))?.id ?? null;
	};

	private _persistState = (panelId: string): void => {
		if (this.config.persist && this.element.id) writeStored(`ps:${this.element.id}`, panelId);
		if (this.config.deepLink) {
			this._updatePanelParam(panelId);
		} else {
			// No deepLink: clean up any stale ?panel= IDs left by a snap-open.
			const myIds = new Set(this.panels.map(p => p.id).filter(Boolean));
			const current = readPanelParam();
			if (current.some(id => myIds.has(id))) writePanelParam(current.filter(id => !myIds.has(id)));
		}
	};

	private _updatePanelParam = (panelId: string): void => {
		const myIds = new Set(this.panels.map(p => p.id).filter(Boolean));
		const next = [...readPanelParam().filter(id => !myIds.has(id)), panelId].filter(Boolean);
		writePanelParam(next);
	};

	private _resolveInitialPanel = (): string | null => {
		// URL param is always honoured: a ?panel=id link is explicit and
		// page-specific, so shareable deep links work with no config.
		const fromUrl = this._parsePanelParam();
		if (fromUrl) return fromUrl;
		// localStorage is opt-in only, so a stale entry can't override the markup
		// .active panel unless this set actually persists.
		if (this.config.persist) {
			const { id } = this.element;
			if (!id) return null;
			const saved = readStored(`ps:${id}`);
			return saved && this.panels.some(p => p.id === saved) ? saved : null;
		}
		return null;
	};

	private static _validateElement(element: HTMLElement): void {
		if (!element.hasAttribute('data-panelset') && !element.tagName.includes('-')) {
			throw new Error('PanelSet: element must have [data-panelset] or be a custom element');
		}
	}

	private _autoWrapPanels(): HTMLElement {
		const wrapper = document.createElement('div');
		wrapper.className = 'panel-wrapper';
		this.panels.forEach(panel => wrapper.appendChild(panel));
		this.element.appendChild(wrapper);
		return wrapper;
	}

	// Collect this set's own [role="tabpanel"] panels. querySelectorAll is
	// unscoped, so a nested PanelSet/Panel could otherwise have its panels claimed
	// by an outer instance; closest() keeps only panels whose nearest panelset/
	// panel container is this element.
	private _collectPanels(): HTMLElement[] {
		const ownContainer = (el: HTMLElement): boolean =>
			el.closest('[data-panelset], ps-panelset, [data-panel], ps-panel') === this.element;
		return Array.from(this.element.querySelectorAll<HTMLElement>('[role="tabpanel"]')).filter(ownContainer);
	}

	private _internalInit(): void {
		this.panels.forEach(panel => {
			panel.classList.remove('fade', 'incoming', 'outgoing', 'levelup', 'leveldown');
			if (panel !== this.activePanel) {
				panel.hidden = true;
				panel.classList.remove('active');
			} else {
				panel.hidden = false;
				panel.classList.add('active');
			}
		});
		this.element.style.height = '';
		this._updateHighestPanel();
		if (this.config.manageTriggers) this._updateTabTriggers(this.activePanel);
	}
	

	// Dispatch custom event helper
	private _dispatch<T = unknown>(eventName: string, detail: T): void {
		this.element.dispatchEvent(
			new CustomEvent(eventName, {
				detail,
				bubbles: true,
				cancelable: false
			})
		);
	}

	/* --- Modular helpers --- */

	private _getVerticalMetrics(el: HTMLElement | null): number {
		if (!el) return 0;
		const s = getComputedStyle(el);
		return (parseFloat(s.paddingTop) || 0) + (parseFloat(s.paddingBottom) || 0)
		     + (parseFloat(s.borderTopWidth) || 0) + (parseFloat(s.borderBottomWidth) || 0);
	}

	private _measureHeight(panel: HTMLElement): number {
		let total = panel.offsetHeight;
		total += this._getVerticalMetrics(this.panelWrapper);
		total += this._getVerticalMetrics(this.element);
		return total;
	}

	private _updateHighestPanel(): void {
		if (this.element.hasAttribute('data-panelset-trackheight')) {
			console.warn('PanelSet: data-panelset-trackheight on parent only');
			return;
		}
		const trackingParent = this.element.closest<HTMLElement>('[data-panelset-trackheight]');
		if (!trackingParent) return;

		// Hide all panels before measuring each one individually.
		this.panels.forEach(p => { p.hidden = true; p.classList.remove('active'); });

		let max = 0;
		this.panels.forEach(panel => {
			panel.hidden = false;
			panel.classList.add('active');
			panel.style.visibility = 'hidden';
			const h = this.element.offsetHeight;
			if (h > max) max = h;
			panel.hidden = true;
			panel.classList.remove('active');
			panel.style.visibility = '';
		});

		// Restore the active panel.
		if (this.activePanel) {
			this.activePanel.hidden = false;
			this.activePanel.classList.add('active');
		}

		trackingParent.style.setProperty('--ps-max-height', `${max}px`);
		this._log(`Max container height: ${max}px`);
	}

	private _updateTabTriggers(activePanel: HTMLElement): void {
		this.panels.forEach(panel => {
			if (!panel.id) return;
			document.querySelectorAll<HTMLElement>(`[aria-controls="${panel.id}"]`).forEach(trigger => {
				trigger.setAttribute('aria-selected', String(panel === activePanel));
			});
		});
	}

	private _setTriggersActivating(active: boolean): void {
		this.panels.forEach(panel => {
			if (!panel.id) return;
			document.querySelectorAll<HTMLElement>(`[aria-controls="${panel.id}"]`).forEach(trigger => {
				trigger.classList.toggle('is-activating', active);
			});
		});
	}

	private _cleanupPanels(newPanel: HTMLElement): void {
		this.panels.forEach(panel => {
			panel.classList.remove('fade', 'incoming', 'outgoing', 'levelup', 'leveldown');
			if (panel !== newPanel) {
				panel.classList.remove('active');
				panel.hidden = true;
			} else {
				panel.classList.add('active');
				panel.hidden = false;
				panel.removeAttribute('inert');
			}
		});
		this.element.style.height = '';
		this.element.classList.remove('is-transitioning');
		this.activePanel = newPanel;
		if (this.config.manageTriggers) this._updateTabTriggers(newPanel);
	}

	private _resolveAutoFocus(resolvedTrigger: HTMLElement | null, autoFocus?: AutoFocusMode): AutoFocusMode | undefined {
		if (this.config.manageTriggers) {
			const attrValue = resolvedTrigger?.getAttribute('data-auto-focus');
			if (attrValue != null) {
				if (attrValue === 'true') return true;
				if (attrValue === 'false') return false;
				if (attrValue === 'heading' || attrValue === 'first' || attrValue === 'input') return attrValue as AutoFocusMode;
			}
		}
		if (autoFocus !== undefined) return autoFocus;
		return this.config.autoFocus;
	}

	private _handleAutoFocus(panel: HTMLElement, mode: AutoFocusMode, event?: Event): void {
		autoFocus(panel, mode, event);
	}

	// Shared helper for open/close
	private _animateOpenClose(isOpening: boolean, withTransition: boolean, event?: Event): void {
		const action = isOpening ? 'opening' : 'closing';
		const oppositeClass = `is-${isOpening ? 'closing' : 'opening'}`;
		const actionClass = `is-${action}`;

		this._log(isOpening ? 'Opening' : 'Closing');

		const signal = this._animOpenClose.start();

		// Capture position before removing the opposite class — needed to resume
		// from where it is, not from the start, when reversing mid-animation.
		const isReversing = this.element.classList.contains(oppositeClass);
		const reverseStartHeight = isReversing ? this.element.offsetHeight : null;

		// Capture the open height BEFORE removing is-open. Since closable sets are
		// closed-by-default (height:0 when not .is-open), removing is-open collapses
		// the resting height immediately — so a later offsetHeight read would return 0
		// and the close would animate 0 → 0 (no transition). This is the real "from".
		const closeStartHeight = !isOpening ? this.element.offsetHeight : null;

		this.element.classList.remove(oppositeClass);
		if (!isOpening) this.element.classList.remove('is-open');

		if (isOpening) this.element.removeAttribute('inert');

		// Settle into the closed resting state (no is-open class) and restore focus.
		const settleClosed = () => {
			this.element.setAttribute('inert', '');
			const byPointer = event instanceof PointerEvent && event.pointerType !== '';
			if (this.config.returnFocus && this._returnFocusTarget && !byPointer) {
				this._returnFocusTarget.focus();
			}
		};

		if (withTransition && this.config.transitions) {
			// Mirror Panel exactly: animate under the .is-opening / .is-closing class
			// only, never pinning the wrapper. The wrapper reveal lives entirely in CSS
			// (.is-opening / .is-closing .panel-wrapper) and animates from whatever value
			// is currently committed — so a reclick mid-transition just swaps the class
			// and the browser interpolates from the live position. .is-open is added only
			// once the animation settles. height:auto during opening comes from the
			// @supports .is-opening rule, so is-open is not needed mid-animation.
			this.element.classList.add(actionClass);

			if (PanelSet._nativeInterpolateSize) {
				if (isOpening) {
					this.element.style.height = reverseStartHeight !== null ? `${reverseStartHeight}px` : '0px';
					requestAnimationFrame(() => {
						this.element.style.height = ''; // .is-opening's height: auto takes over
						Core.waitForTransition(this.element, 'height').then(() => {
							if (signal.aborted) return;
							// Wait for the wrapper transition too — its GPU layer keeps the
							// clip alive in WebKit until it finishes.
							const wrapperDone = this.panelWrapper
								? Core.waitForTransition(this.panelWrapper)
								: Promise.resolve();
							wrapperDone.then(() => {
								if (signal.aborted) return;
								this.element.classList.remove(actionClass);
								this.element.classList.add('is-open');
								void this.element.offsetHeight;
							});
						});
					});
				} else {
					// Lock at px — interpolate-size alone can't animate auto → 0 in Firefox.
					// Use the height captured before is-open was removed (resting height
					// is already 0 now that the class is gone).
					this.element.style.height = reverseStartHeight !== null
						? `${reverseStartHeight}px`
						: `${closeStartHeight}px`;
					requestAnimationFrame(() => {
						this.element.style.height = ''; // closed resting height: 0 takes over
						Core.waitForTransition(this.element, 'height').then(() => {
							if (signal.aborted) return;
							this.element.classList.remove(actionClass);
							void this.element.offsetHeight;
							settleClosed();
						});
					});
				}
			} else {
				// JS fallback: measure > lock > animate > unlock
				const targetHeight = isOpening ? this._measureHeight(this.pendingPanel) : 0;
				// On open the current height is the (closed) start, unless reversing a
				// close mid-flight; on close use the height captured before is-open was
				// removed (resting height is already 0).
				const currentHeight = reverseStartHeight !== null
					? reverseStartHeight
					: (isOpening ? this.element.offsetHeight : (closeStartHeight ?? 0));
				this.element.style.height = `${currentHeight}px`;
				// Force a flush so the Npx lock is committed before the rAF changes it.
				// Without it the lock is overwritten and Firefox sees auto → 0px in one
				// step — non-animatable, so it jumps.
				void getComputedStyle(this.element).height;

				requestAnimationFrame(() => {
					this.element.style.height = `${targetHeight}px`;

					Core.waitForTransition(this.element).then(() => {
						if (signal.aborted) return;
						this.element.style.height = '';
						this.element.classList.remove(actionClass);
						if (isOpening) this.element.classList.add('is-open');
						void this.element.offsetHeight;
						if (!isOpening) settleClosed();
					});
				});
			}
		} else {
			if (isOpening) {
				this.element.classList.add('is-open');
			} else {
				this.element.classList.remove('is-open');
				settleClosed();
			}
			this.element.style.height = '';
		}
	}

	/**
	 * Get the ID of the currently active panel
	 * @returns Panel ID or null if no panel is active
	 */
	getActive(): string | null {
		return this.pendingPanel?.id || null;
	}

	/**
	 * Re-scan the DOM for this set's panels and reconcile internal state. Call
	 * after adding, removing, or reordering [role="tabpanel"] elements at runtime
	 * (e.g. lazy or windowed wizards). The active panel is preserved when it is
	 * still present; otherwise it falls back to the marked .active panel, then the
	 * first panel. Newly added panels are initialised to the hidden state.
	 * Call when idle (not mid-transition).
	 */
	refresh(): void {
		const previousActive = this.activePanel;
		this.panels = this._collectPanels();
		if (this.panels.length === 0) return;

		this.activePanel = (previousActive && this.panels.includes(previousActive))
			? previousActive
			: (this.panels.find(p => p.classList.contains('active')) ?? this.panels[0]);
		this.pendingPanel = this.activePanel;
		// A runtime-added wrapper (or first wrap) may differ from the cached one.
		this.panelWrapper = this.element.querySelector<HTMLElement>(':scope > .panel-wrapper') || this.panelWrapper;

		this._internalInit();
		this._log(`Refreshed (${this.panels.length} panels)`);
	}

	/**
	 * Insert a panel at runtime and refresh. The node is appended to the wrapper
	 * unless a position is given. Ensures the element carries role="tabpanel".
	 * @param panel - The [role="tabpanel"] element to add.
	 * @param position - { before } / { after } an existing panel id, or { index }.
	 * @returns The inserted panel.
	 */
	addPanel(panel: HTMLElement, position?: { before?: string; after?: string; index?: number }): HTMLElement {
		if (!panel.hasAttribute('role')) panel.setAttribute('role', 'tabpanel');

		let ref: HTMLElement | null = null;
		if (position?.before) {
			ref = this.panels.find(p => p.id === position.before) ?? null;
		} else if (position?.after) {
			const after = this.panels.find(p => p.id === position.after);
			ref = (after?.nextElementSibling as HTMLElement | null) ?? null;
		} else if (typeof position?.index === 'number') {
			ref = this.panels[position.index] ?? null;
		}

		(this.panelWrapper || this._autoWrapPanels()).insertBefore(panel, ref);
		this.refresh();
		return panel;
	}

	/**
	 * Remove a panel by id and refresh. If the removed panel was active, refresh()
	 * promotes a fallback panel. No-op if the id is not found.
	 * @param panelId - ID of the panel to remove.
	 */
	removePanel(panelId: string): void {
		const panel = this.panels.find(p => p.id === panelId);
		if (!panel) return;
		panel.remove();
		this.refresh();
	}

	/**
	 * Tear down this instance: abort any pending animations, disconnect the
	 * height-tracking ResizeObserver, and drop the reference from the element.
	 * The DOM (panels, classes) is left as-is. Re-init with new PanelSet() or
	 * PanelSet.init() afterwards if needed.
	 */
	destroy(): void {
		this._animShow.start();       // abort pending .then() callbacks (they check signal.aborted)
		this._animOpenClose.start();
		this._heightObserver?.disconnect();
		this._heightObserver = null;
		delete this.element.panelSet;
		this._log('Destroyed');
	}

	// Edge info for the currently targeted panel (pendingPanel), for event detail.
	private _edgeInfo(panel: HTMLElement | undefined): { index: number; total: number; atStart: boolean; atEnd: boolean } {
		const total = this.panels.length;
		const index = panel ? this.panels.indexOf(panel) : -1;
		return { index, total, atStart: index <= 0, atEnd: index === total - 1 };
	}

	/**
	 * Activate the next panel in DOM order. Stops at the last panel unless the
	 * `loop` option is set, in which case it wraps to the first.
	 * @param options - Configuration options for the activation
	 */
	next(options?: ShowOptions): void {
		this._step(1, options);
	}

	/**
	 * Activate the previous panel in DOM order. Stops at the first panel unless
	 * the `loop` option is set, in which case it wraps to the last.
	 * @param options - Configuration options for the activation
	 */
	prev(options?: ShowOptions): void {
		this._step(-1, options);
	}

	private _step(dir: 1 | -1, options?: ShowOptions): void {
		const total = this.panels.length;
		if (total === 0) return;
		// Step from the panel being targeted, so rapid clicks queue correctly.
		const from = this.panels.indexOf(this.pendingPanel);
		const current = from === -1 ? 0 : from;
		let target = current + dir;
		if (target < 0 || target >= total) {
			if (!this.config.loop) return;     // clamp at the ends
			target = (target + total) % total; // wrap
		}
		const next = this.panels[target];
		if (next && next !== this.pendingPanel) this.show(next.id, options);
	}


	/**
	 * Open a closable panelset
	 * @param options - Configuration options
	 */
	open(options?: ShowOptions): void {
		const {
			event,
			transition = true,
			autoFocus
		} = options || {};

		if (!this.config.closable) {
			this._log('Not closable');
			return;
		}

		const isClosed = this._isClosed;
		const isClosing = this.element.classList.contains('is-closing');
		const isLoading = this.element.classList.contains('is-loading');

		if (!isClosed && !isClosing) return;
		if (this.element.classList.contains('is-transitioning') && !isLoading) return;

		// Derive trigger for data-attribute check
		const resolvedTrigger = event?.target instanceof HTMLElement 
			? (event.target.closest('button, a, [role="tab"]') as HTMLElement) ?? event.target
			: null;

		const finalAutoFocus = this._resolveAutoFocus(resolvedTrigger, autoFocus);
		if (resolvedTrigger) this._returnFocusTarget = resolvedTrigger;

		this._animateOpenClose(true, transition);
		
		// Handle autofocus after opening
		if (finalAutoFocus !== false && finalAutoFocus !== undefined && this.pendingPanel) {
			if (transition && this.config.transitions) {
				Core.waitForTransition(this.element).then(() => {
					this._handleAutoFocus(this.pendingPanel, finalAutoFocus, event);
				});
			} else {
				this._handleAutoFocus(this.pendingPanel, finalAutoFocus, event);
			}
		}
	}


	/**
	 * Close a closable panelset
	 * @param options - Configuration options
	 */
	close(options?: ShowOptions): void {
		const {
			transition = true,
			event
		} = options || {};

		if (!this.config.closable) {
			this._log('Not closable');
			return;
		}

		const isClosed = this._isClosed;
		const isClosing = this.element.classList.contains('is-closing');
		const isOpening = this.element.classList.contains('is-opening');
		const isLoading = this.element.classList.contains('is-loading');

		if ((isClosed || isClosing) && !isOpening) return;
		if (this.element.classList.contains('is-transitioning') && !isLoading) return;

		this._animateOpenClose(false, transition, event);
	}


	/**
	 * Toggle a closable panelset between open and closed
	 * @param options - Configuration options
	 */
	toggle(options?: ShowOptions): void {
		const {
			event,
			transition = true,
			autoFocus
		} = options || {};

		const isClosed = this._isClosed;
		const isClosing = this.element.classList.contains('is-closing');

		// If closed or closing, open it
		if (isClosed || isClosing) {
			// Just pass through to open() - it handles priority cascade
			this.open({ event, transition, autoFocus });
		} else {
			this.close({ transition, event });
		}
	}

	/**
	 * Register a handler for async content loading
	 * @param handler - Async content handler function
	 * @param options - Handler options (once: whether to load only once)
	 */
	onBeforeOpen(handler: AsyncContentHandler, options: HandlerOptions = {}): void {
		this.hasAsyncContent = true;
		registerBeforeOpenHandler<BeforeOpenEventDetail>(
			this.element,
			'ps:beforeopen',
			(detail) => detail.targetPanel,
			handler,
			options
		);
	}

	/* --- Main logic --- */


	/**
	 * Show a panel by ID
	 * @param panelId - ID of the panel to show
	 * @param options - Configuration options for this activation
	 */
	async show(panelId: string, options?: ShowOptions): Promise<void> {
		if (this.config.interruptible === false && this._activating) return;

		const {
			event,
			transition = true,
			autoFocus
		} = options || {};

		// Always derive trigger from event
		const resolvedTrigger = event?.target instanceof HTMLElement 
			? (event.target.closest('button, a, [role="tab"]') as HTMLElement) ?? event.target
			: null;

		const finalAutoFocus = this._resolveAutoFocus(resolvedTrigger, autoFocus);

		const newPanel = this.panels.find(p => p.id === panelId);

		if (!newPanel) {
			this._log(`Panel not found: ${panelId}`);
			return;
		}

		// Cancelable gate, fired before any state changes. A listener can call
		// preventDefault() to veto the activation — e.g. a wizard that only allows
		// a step once required fields are filled. Covers every path (tab click,
		// next()/prev(), deep link) since they all funnel through show().
		const beforeActivate = new CustomEvent<BeforeActivateEventDetail>('ps:beforeactivate', {
			detail: {
				panelId,
				targetPanel: newPanel,
				outgoingPanel: this.activePanel ?? null,
				trigger: resolvedTrigger
			},
			bubbles: true,
			cancelable: true
		});
		if (!this.element.dispatchEvent(beforeActivate)) {
			this._log(`Vetoed by ps:beforeactivate: ${panelId}`);
			return;
		}

		const isClosed = this._isClosed;
		const isClosing = this.element.classList.contains('is-closing');
		const isLoading = this.element.classList.contains('is-loading');

		if (newPanel === this.pendingPanel) {
			if (isClosed || isClosing) {
				// Same panel, but closed or closing: open it
				this.open({ event, transition, autoFocus: finalAutoFocus });
			} else if (this.config.closable && this.config.closeOnTab) {
				// Clicking the active tab while open: close if closeOnTab is enabled
				this.close({ transition, event });
			}
			return;
		}

		// Block tab switches during open/close animations (but not during async loading)
		if ((this.element.classList.contains('is-opening') || isClosing) && !isLoading) return;

		// When closed: silently swap to the target panel, then open
		if (isClosed) {
			this.pendingPanel = newPanel;
			this._cleanupPanels(newPanel);
			this.open({ event, transition, autoFocus: finalAutoFocus });
			return;
		}

		const switchInFlight = this._activating;
		this._activating = true;
		if (this.config.manageTriggers && this.config.interruptible === false) this._setTriggersActivating(true);

		const prevPanel = this.pendingPanel;
		const prevPanelId = prevPanel?.id;
		this.pendingPanel = newPanel;

		// Reversal: a switch is mid-flight and the user re-requested the panel that
		// is still animating out (the current activePanel). Treat the in-flight
		// incoming panel (prevPanel) as the new outgoing one and apply the opposite
		// direction, so the CSS transition rolls back from the live positions.
		const isReversal = switchInFlight && newPanel === this.activePanel && prevPanel !== newPanel;
		if (this.config.manageTriggers) this._updateTabTriggers(newPanel);

		this._persistState(panelId);

		this.element.classList.remove('is-loading');

		if (!isReversal && prevPanel && prevPanel !== this.activePanel && prevPanel !== newPanel) {
			prevPanel.classList.remove('incoming', 'outgoing', 'levelup', 'leveldown');
			if (prevPanel.hidden) {
				// Was never visible, keep hidden
			} else {
				prevPanel.classList.remove('active');
			}
		}

		const wasLoadingAsync = this._isLoadingAsync;

		// start() aborts the previous signal — cancels in-flight animation AND
		// any fetch() that received the previous signal via ps:beforeopen.
		const prevSignalAborted = this._animShow.signal.aborted;
		const signal = this._animShow.start();

		if (!prevSignalAborted && wasLoadingAsync && prevPanelId && prevPanelId !== panelId) {
			this._dispatch<ActivationAbortedEventDetail>('ps:activationaborted', {
				panelId: prevPanelId,
				trigger: resolvedTrigger
			});
		}

		this._isLoadingAsync = false;

		this._log(`${prevPanel?.id || 'none'} > ${panelId}`);

		const beforeOpenDetail: BeforeOpenEventDetail = {
			panelId,
			targetPanel: newPanel,
			outgoingPanel: prevPanel,
			signal,
			promise: null
		};

		const beforeOpenEvent = new CustomEvent('ps:beforeopen', {
			detail: beforeOpenDetail,
			bubbles: true,
			cancelable: false
		});

		this.element.dispatchEvent(beforeOpenEvent);

		const userPromise = beforeOpenDetail.promise;

		if (userPromise) {
			this._isLoadingAsync = true;
			this._log('Waiting for content...');

				// Add is-loading immediately so the wrapper dims without flash.
			// The spinner's appearance is delayed via CSS transition-delay
			// (--ps-loading-delay) so it only shows for slow loads, without a JS timer.
			this.element.style.setProperty('--ps-loading-delay', `${this.config.loadingDelay}ms`);
			this.element.classList.add('is-loading');

			let openTransition: Promise<void> | null = null;

			const shouldTransition = transition !== false && this.config.transitions !== false;
			let heightTransition = shouldTransition;
			if (typeof this.config.transitions === 'object') {
				heightTransition = shouldTransition && this.config.transitions.height !== false;
			}

			if (heightTransition) {
				if (isClosed) {
					this.element.classList.add('is-open', 'is-opening');
					this.element.style.height = '0px';
					requestAnimationFrame(() => {
						this.element.style.height = `${this.config.loadingHeight}px`;
					});
					openTransition = Core.waitForTransition(this.element, 'height');
				} else {
					// loadingHeight is a minimum: only expand if the current height is shorter.
					const currentHeight = this.element.offsetHeight;
					const targetHeight = Math.max(currentHeight, this.config.loadingHeight);
					if (targetHeight > currentHeight) {
						this.element.style.height = `${currentHeight}px`;
						requestAnimationFrame(() => {
							this.element.style.height = `${targetHeight}px`;
						});
						openTransition = Core.waitForTransition(this.element, 'height');
					}
				}
			}

			try {
				await Promise.all([userPromise, openTransition].filter(Boolean) as Promise<void>[]);

				if (signal.aborted) {
					this._log(`Aborted during load: ${panelId}`);
					this.element.classList.remove('is-loading');
					this.element.style.removeProperty('--ps-loading-delay');
					return;
				}

				this._log('Content loaded');

				if (newPanel.dataset.loaded === 'true') {
					this._updateHighestPanel();
				}

			} catch (error) {
				const err = error as Error;
				this._log(`Load failed: ${err.message}`);
				this.element.classList.remove('is-loading');
				this.element.style.removeProperty('--ps-loading-delay');

				if (err.name !== 'AbortError') {
					console.error('Panel load error:', error);
				}

				this._activating = false;
				if (this.config.manageTriggers && this.config.interruptible === false) this._setTriggersActivating(false);
				return;
			}

			this.element.classList.remove('is-loading');
			this.element.style.removeProperty('--ps-loading-delay');
			this.element.classList.remove('is-opening');
		}

		if (signal.aborted) {
			this._log(`Aborted: ${panelId}`);
			return;
		}

		const outgoingPanel = isReversal ? prevPanel : this.activePanel;

		this._dispatch<ActivationEventDetail>('ps:activationstart', {
			panelId,
			trigger: resolvedTrigger,
			outgoingPanel,
			...this._edgeInfo(newPanel)
		});

		const shouldTransition = transition !== false && this.config.transitions !== false;

		let panelTransition = shouldTransition;
		let heightTransition = shouldTransition;

		if (typeof this.config.transitions === 'object') {
			panelTransition = shouldTransition && this.config.transitions.panels !== false;
			heightTransition = shouldTransition && this.config.transitions.height !== false;
		}

		this.panels.forEach(panel => panel.classList.toggle('fade', panelTransition));

		// Direction (levels feature). DOM order is the implicit level: a later
		// panel is "higher". Going to a higher panel is levelup, lower is leveldown.
		// When levels is off, no direction class is set and the default
		// (--ps-panel-in-transform-from / --ps-panel-out-transform-to) direction is always used.
		let direction: 'levelup' | 'leveldown' | null = null;
		if (isReversal) {
			// Opposite of the in-flight direction. A plain (no-levels) slide always
			// runs in the default (levelup) direction, so its reverse is leveldown.
			direction = this._switchDirection === 'leveldown' ? 'levelup' : 'leveldown';
		} else if (this.config.levels && outgoingPanel && outgoingPanel !== newPanel) {
			const fromIdx = this.panels.indexOf(outgoingPanel);
			const toIdx   = this.panels.indexOf(newPanel);
			if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
				direction = toIdx > fromIdx ? 'levelup' : 'leveldown';
			}
		}
		this._switchDirection = direction;

		// Clear any stale state from an interrupted switch synchronously, so CSS
		// transitions interpolate from the current position rather than snapping.
		this.panels.forEach(p => p.classList.remove('outgoing', 'levelup', 'leveldown'));

		const startHeight = this.element.offsetHeight;
		if (heightTransition) {
			this.element.style.height = `${startHeight}px`;
		}

		newPanel.hidden = false;
		newPanel.setAttribute('inert', '');
		newPanel.classList.add('incoming');
		if (direction) newPanel.classList.add(direction);
		if (panelTransition) {
			this.element.classList.add('is-transitioning');
		}
		if (outgoingPanel && outgoingPanel !== newPanel) {
			outgoingPanel.classList.remove('active', 'incoming');
			outgoingPanel.classList.add('outgoing');
			if (direction) outgoingPanel.classList.add(direction);
			outgoingPanel.hidden = false;
			outgoingPanel.setAttribute('inert', '');
		}

		// Double rAF: first frame commits incoming (opacity:0) state to the
		// rendering pipeline; second frame adds active (opacity:1) so the
		// fade-in transition fires. Single rAF causes Firefox to skip the
		// transition and show the new panel at full opacity immediately.
		requestAnimationFrame(() => requestAnimationFrame(() => {
			newPanel.classList.add('active');
			if (outgoingPanel && outgoingPanel !== newPanel) {
				outgoingPanel.classList.remove('incoming');
			}

			const targetHeight = this._measureHeight(newPanel);
			const heightChanged = startHeight !== targetHeight;

			if (heightTransition) {
				this.element.style.height = `${targetHeight}px`;
			}

			const promises: Promise<void>[] = [];
			if (panelTransition) {
				promises.push(Core.waitForTransition(newPanel));
			}
			if (heightTransition && heightChanged) {
				promises.push(Core.waitForTransition(this.element));
			}
			if (!promises.length) promises.push(Promise.resolve());

			Promise.all(promises).then(() => {
				if (signal.aborted) {
					this._log(`Interrupted: ${panelId}`);
					return;
				}

				this._cleanupPanels(newPanel);
				this._log(`✓ ${panelId}`);

				if (finalAutoFocus !== false && finalAutoFocus !== undefined) {
					this._handleAutoFocus(newPanel, finalAutoFocus, event);
				}

				this._activating = false;
				if (this.config.manageTriggers && this.config.interruptible === false) this._setTriggersActivating(false);
				this._dispatch<ActivationEventDetail>('ps:activationcomplete', {
					panelId,
					trigger: resolvedTrigger,
					outgoingPanel,
					...this._edgeInfo(newPanel)
				});
			});
		}));
	}

}

export default PanelSet;