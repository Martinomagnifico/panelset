import '../style/panelset.scss';
import { Core } from './functions/core';
import { autoFocus } from './functions/focus';
import type { AutoFocusMode } from './functions/focus';
import { readPanelParam, writePanelParam, readStored, writeStored } from './functions/persist';


import type { PanelSetConfig, ReadyEventDetail, BeforeOpenEventDetail, ActivationEventDetail, ActivationAbortedEventDetail, HandlerOptions, ShowOptions, AsyncContentHandler } from './panelset.types';
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
 *  - State classes: toggling active, is-transitioning, is-loading, is-closed,
 *    is-opening, is-closing on panels and the container.
 *  - Trigger wiring: binding click handlers on [aria-controls] buttons/tabs
 *    and delegating to show().
 *  - ARIA: managing aria-expanded, aria-controls, aria-selected, and
 *    aria-hidden so assistive technology tracks the active panel correctly.
 *  - Keyboard navigation: arrow keys, Home/End within a tablist, Tab/Shift-Tab
 *    to move between tab and panel.
 *  - Focus management: moving focus into the new panel on activation (autoFocus)
 *    and returning it to the trigger on close (returnFocus).
 *  - Lifecycle events: dispatching ps:ready, ps:beforeopen, ps:activationstart,
 *    ps:activationcomplete, and ps:activationaborted for userland hooks.
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
		closable: false,
		closeOnTab: false,
		loadingHeight: 200,
		loadingDelay: 300,
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

	private _animShow    = new Core(); // panel switching + async content
	private _animOpenClose = new Core(); // container open/close
	private _isLoadingAsync: boolean = false;
	private _activating: boolean = false;
	private _returnFocusTarget: HTMLElement | null = null;

	private static readonly _nativeInterpolateSize =
		typeof CSS !== 'undefined' && CSS.supports('interpolate-size: allow-keywords');

	static readonly attrs: AttrMap<PanelSetConfig> = {
		align:         ['panelsetAlign',  'string'],
		transitions:   ['transitions',   'json'],
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

		const dataConfig = parseDataAttrs<PanelSetConfig>(element.dataset, PanelSet.attrs);
		this.config = { ...PanelSet.defaults, ...dataConfig, ...options } as Required<Omit<PanelSetConfig, 'selector'>>;

		this.panels = Array.from(element.querySelectorAll<HTMLElement>('[role="tabpanel"]'));

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
		this.panelWrapper =
			this.element.querySelector<HTMLElement>('.panel-wrapper') || this._autoWrapPanels();

		this.pendingPanel = this.activePanel;




		this.element.dataset.panelsetAlign = this.config.align;
		this.element.setAttribute('data-panelset-ready', ''); // For styling
		if (this.element.classList.contains('is-closed')) this.element.setAttribute('inert', '');

		if (PanelSet._nativeInterpolateSize) logInterpolateSizeOnce(this.config.debug);
		this._log(`Initialized (${this.panels.length} panels)`);
		this._dispatch<ReadyEventDetail>('ps:ready', { container: this.element, instance: this });

		this._internalInit();

		let resizeTimeout: ReturnType<typeof setTimeout>;
		window.addEventListener('resize', () => {
			clearTimeout(resizeTimeout);
			resizeTimeout = setTimeout(() => {
				this._updateHighestPanel();
			}, 250);
		});

	}

	// Debug logging helper
	private _log(message: string): void { log('PanelSet', this.element, this.config.debug, message); }

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
		const fromUrl = this._parsePanelParam();
		if (fromUrl) return fromUrl;
		const { id } = this.element;
		if (!id) return null;
		const saved = readStored(`ps:${id}`);
		return saved && this.panels.some(p => p.id === saved) ? saved : null;
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

	private _internalInit(): void {
		this.panels.forEach(panel => {
			panel.classList.remove('fade', 'incoming');
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
			panel.classList.remove('fade', 'incoming');
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

		this.element.classList.remove(oppositeClass);

		if (isOpening) this.element.removeAttribute('inert');

		if (withTransition && this.config.transitions) {
			this.element.classList.add(actionClass);

			if (PanelSet._nativeInterpolateSize) {
				if (isOpening) {
					this.element.classList.remove('is-closed');
					// Lock at px first so the rAF clear gives the browser a concrete
					// before state. Without it, is-closed removal and is-opening's
					// height: auto land in the same task — no delta, no transition.
					this.element.style.height = reverseStartHeight !== null ? `${reverseStartHeight}px` : '0px';
					requestAnimationFrame(() => {
						this.element.style.height = ''; // is-opening's height: auto takes over
						Core.waitForTransition(this.element, 'height').then(() => {
							if (signal.aborted) return;
							// Wait for the wrapper opacity transition too — its GPU layer
							// keeps the clip alive in WebKit until it finishes.
							const wrapperDone = this.panelWrapper
								? Core.waitForTransition(this.panelWrapper)
								: Promise.resolve();
							wrapperDone.then(() => {
								if (signal.aborted) return;
								this.element.classList.remove(actionClass);
								void this.element.offsetHeight;
							});
						});
					});
				} else {
					// Lock at px — interpolate-size alone can't animate auto → 0 in Firefox.
					this.element.style.height = reverseStartHeight !== null
						? `${reverseStartHeight}px`
						: `${this.element.offsetHeight}px`;
					requestAnimationFrame(() => {
						this.element.style.height = ''; // is-closing's height: 0 takes over
						Core.waitForTransition(this.element, 'height').then(() => {
							if (signal.aborted) return;
							this.element.classList.remove(actionClass);
							void this.element.offsetHeight;
							this.element.classList.add('is-closed');
							this.element.setAttribute('inert', '');
							const byPointer = event instanceof PointerEvent && event.pointerType !== '';
							if (this.config.returnFocus && this._returnFocusTarget && !byPointer) {
								this._returnFocusTarget.focus();
							}
						});
					});
				}
			} else {
				// JS fallback: measure > lock > animate > unlock
				const targetHeight = isOpening ? this._measureHeight(this.pendingPanel) : 0;
				const currentHeight = this.element.offsetHeight;
				this.element.style.height = `${currentHeight}px`;

				if (isOpening) {
					this.element.classList.remove('is-closed');
				} else {
					// Force a flush so the Npx lock is committed before the rAF
					// changes to 0px. Without it Firefox sees auto → 0px — non-animatable.
					void getComputedStyle(this.element).height;
				}

				requestAnimationFrame(() => {
					this.element.style.height = `${targetHeight}px`;

					Core.waitForTransition(this.element).then(() => {
						if (signal.aborted) return;
						this.element.style.height = '';
						this.element.classList.remove(actionClass);
						void this.element.offsetHeight;
						if (!isOpening) {
							this.element.classList.add('is-closed');
							this.element.setAttribute('inert', '');
							const byPointer = event instanceof PointerEvent && event.pointerType !== '';
							if (this.config.returnFocus && this._returnFocusTarget && !byPointer) {
								this._returnFocusTarget.focus();
							}
						}
					});
				});
			}
		} else {
			if (isOpening) {
				this.element.classList.remove('is-closed');
			} else {
				this.element.classList.add('is-closed');
				this.element.setAttribute('inert', '');
				const byPointer = event instanceof PointerEvent && event.pointerType !== '';
				if (this.config.returnFocus && this._returnFocusTarget && !byPointer) {
					this._returnFocusTarget.focus();
				}
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

		const isClosed = this.element.classList.contains('is-closed');
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

		const isClosed = this.element.classList.contains('is-closed');
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

		const isClosed = this.element.classList.contains('is-closed');
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

		const isClosed = this.element.classList.contains('is-closed');
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

		this._activating = true;
		if (this.config.manageTriggers && this.config.interruptible === false) this._setTriggersActivating(true);

		const prevPanel = this.pendingPanel;
		const prevPanelId = prevPanel?.id;
		this.pendingPanel = newPanel;
		if (this.config.manageTriggers) this._updateTabTriggers(newPanel);

		this._persistState(panelId);

		this.element.classList.remove('is-loading');

		if (prevPanel && prevPanel !== this.activePanel && prevPanel !== newPanel) {
			prevPanel.classList.remove('incoming');
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

			const hasPreviousPanel = this.activePanel && this.activePanel !== newPanel;
			let openTransition: Promise<void> | null = null;

			if (!hasPreviousPanel || isClosed) {
				const shouldTransition = transition !== false && this.config.transitions !== false;
				let heightTransition = shouldTransition;
				if (typeof this.config.transitions === 'object') {
					heightTransition = shouldTransition && this.config.transitions.height !== false;
				}

				if (heightTransition) {
					if (isClosed) {
						this.element.classList.remove('is-closed');
						this.element.classList.add('is-opening');
						this.element.style.height = '0px';
					} else {
						const currentHeight = this.element.offsetHeight;
						this.element.style.height = `${currentHeight}px`;
					}

					requestAnimationFrame(() => {
						this.element.style.height = `${this.config.loadingHeight}px`;
					});

					// Capture the opening transition so content arriving mid-animation
					// doesn't trigger a resize before the panel reaches loadingHeight.
					// Filter by 'height' so the ::after spinner's opacity transitionend
					// doesn't resolve this promise prematurely.
					openTransition = Core.waitForTransition(this.element, 'height');
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

		const outgoingPanel = this.activePanel;

		this._dispatch<ActivationEventDetail>('ps:activationstart', {
			panelId,
			trigger: resolvedTrigger,
			outgoingPanel
		});

		const shouldTransition = transition !== false && this.config.transitions !== false;

		let panelTransition = shouldTransition;
		let heightTransition = shouldTransition;

		if (typeof this.config.transitions === 'object') {
			panelTransition = shouldTransition && this.config.transitions.panels !== false;
			heightTransition = shouldTransition && this.config.transitions.height !== false;
		}

		this.panels.forEach(panel => panel.classList.toggle('fade', panelTransition));

		const startHeight = this.element.offsetHeight;
		if (heightTransition) {
			this.element.style.height = `${startHeight}px`;
		}

		newPanel.hidden = false;
		newPanel.setAttribute('inert', '');
		newPanel.classList.add('incoming');
		if (panelTransition) {
			this.element.classList.add('is-transitioning');
		}
		if (outgoingPanel && outgoingPanel !== newPanel) {
			outgoingPanel.classList.remove('active', 'incoming');
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
					outgoingPanel
				});
			});
		}));
	}

}

export default PanelSet;