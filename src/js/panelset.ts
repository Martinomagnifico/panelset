import '../style/panelset.scss';
import { Core } from './functions/core.js';
import { autoFocus } from './functions/focus.js';
import type { AutoFocusMode } from './functions/focus.js';
import { readPanelParam, writePanelParam, readStored, writeStored } from './functions/persist.js';


import type { PanelSetConfig, ReadyEventDetail, BeforeActivateEventDetail, BeforeOpenEventDetail, ActivationEventDetail, ActivationAbortedEventDetail, HandlerOptions, ShowOptions, AsyncContentHandler } from './panelset.types.js';
import { parseDataAttrs, type AttrMap } from './functions/config.js';
import { log, logInterpolateSizeOnce, registerBeforeOpenHandler, attachWaitUntil, setDescribedBy } from './functions/utils.js';

declare global {
	interface HTMLElement {
		panelSet?: PanelSet;
	}
}

export class PanelSet {
	// Default configuration
	static defaults: Required<Omit<PanelSetConfig, 'selector'>> = {
		align: 'start',
		transitions: true,
		levels: false,
		loop: false,
		closable: false,
		closeOnTab: false,
		disabledMode: 'aria',
		loadingHeight: 150,
		loadingDelay: 320,
		customIndicator: false,
		returnFocus: false,
		autoFocus: false,
		persist: false,
		deepLink: false,
		interruptible: true,
		manageTriggers: true,
		manageLabels: true,
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
	// The listeners that keep this set's buttons in step with the ends. Dropped on destroy, so a set that is taken apart stops touching them.
	private _verbController = new AbortController();

	private static readonly _nativeInterpolateSize =
		typeof CSS !== 'undefined' && CSS.supports('interpolate-size: allow-keywords');

	// One click listener on the document, shared by every PanelSet, handles the buttons (data-ps-next, -prev, -close). Delegation is necessary, not tidiness: these buttons often sit inside panel content loaded later, which does not exist at init. It goes on with the first set built.
	private static _verbDelegationInstalled = false;

	static readonly attrs: AttrMap<PanelSetConfig> = {
		align:         ['panelsetAlign',  'string'],
		transitions:   ['transitions',   'json'],
		levels:        ['psLevels',      'boolean'],
		loop:          ['psLoop',        'boolean'],
		closable:      ['closable',      'boolean'],
		closeOnTab:    ['closeOnTab',    'boolean'],
		disabledMode:  ['psDisabledMode', 'string'],
		loadingHeight: ['loadingHeight', 'number'],
		// data-panel-* rather than data-*, so it is the SAME attribute a Panel takes. The indicator is a shared concept, and the library's rule for those is one name on both: persist and deepLink already read data-panel-persist and data-panel-deeplink here too.
		customIndicator: ['panelCustomIndicator', 'boolean'],
		loadingDelay:  ['loadingDelay',  'number'],
		autoFocus:      ['autoFocus',      'string'],
		returnFocus:    ['returnFocus',    'boolean'],
		persist:        ['panelPersist',   'boolean'],
		deepLink:       ['panelDeeplink',  'boolean'],
		interruptible:  ['interruptible',  'boolean'],
		manageTriggers: ['manageTriggers', 'boolean'],
		manageLabels:   ['manageLabels',   'boolean'],
		debug:          ['debug',          'boolean'],
	};

	/**
	 * Start up the PanelSets.
	 * @param selectorOrOptions - a CSS selector, or a config object.
	 * @param options - the rest of the config, when the first argument was a selector.
	 * @returns the PanelSets it made.
	 */
	static init(selectorOrOptions: string | PanelSetConfig = {}, options: PanelSetConfig = {}): PanelSet[] {
		// A few different ways to call this.
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

		// Put the shared button listener on the document, once. It guards itself.
		PanelSet._installVerbDelegation();

		// What beats what: defaults, then init() options, then the element's own data attributes. The attribute is closest to the element, so it wins, and that is how one element stays out of a setting you turned on everywhere: data-panel-persist="false" beats PanelSet.init({ persist: true }).

		const dataConfig = parseDataAttrs<PanelSetConfig>(element.dataset, PanelSet.attrs);
		this.config = { ...PanelSet.defaults, ...options, ...dataConfig } as Required<Omit<PanelSetConfig, 'selector'>>;

		// This is what stops the library showing its own spinner. It reflects the RESOLVED config, so the CSS cannot read the authored attribute directly (data-panel-custom-indicator="false" is present but means false). The rule then stops MATCHING rather than merely hiding: a hidden ::after still carries all its declarations, so the author could not reuse the pseudo-element without unpicking every one.
		if (this.config.customIndicator) element.setAttribute('data-ps-custom-indicator', '');

		// This set's own panels and nobody else's, or an outer set walks off with a nested set's panels. See _collectPanels.
		this.panels = this._collectPanels();

		if (this.panels.length === 0) {
			// An empty set is fine: a flow that adds its panels later with addPanel() starts this way. The wrapper is made now so addPanel() has somewhere to put them, and the active panel is settled on the first add, through refresh().
			this.panelWrapper =
				this.element.querySelector<HTMLElement>(':scope > .panel-wrapper') || this._autoWrapPanels();
			this._log('Initialized empty (0 panels), ready for addPanel()');
			this._dispatch<ReadyEventDetail>('ps:ready', { container: this.element, instance: this });
			this._initVerbButtons();
			this._observeTrackHeight();
			return;
		}


		const resolvedId = this._resolveInitialPanel();
		this.activePanel =
			(resolvedId ? this.panels.find(p => p.id === resolvedId) : null)
			?? this.panels.find(p => p.classList.contains('active'))
			?? this.panels[0];
		// Direct child only. Search deeper and you can come back with a nested component's wrapper.
		this.panelWrapper =
			this.element.querySelector<HTMLElement>(':scope > .panel-wrapper') || this._autoWrapPanels();

		this.pendingPanel = this.activePanel;




		// 'start' is the default and no CSS looks for it, so the attribute only goes on for the others. Panel does the same, and it keeps the DOM tidy.
		if (this.config.align !== 'start') this.element.dataset.panelsetAlign = this.config.align;

		// this.element.setAttribute('data-panelset-ready', ''); // For styling (turning this off for now)

		// A closable set starts closed, and only an .is-open in the markup opens it. While closed it is inert.
		if (this.config.closable && !this.element.classList.contains('is-open')) {
			this.element.setAttribute('inert', '');
		}

		if (PanelSet._nativeInterpolateSize) logInterpolateSizeOnce(this.config.debug);
		this._log(`Initialized (${this.panels.length} panels)`);
		this._dispatch<ReadyEventDetail>('ps:ready', { container: this.element, instance: this });

		this._internalInit();

		this._initVerbButtons();

		this._observeTrackHeight();

	}

	// Measure the tallest panel again whenever the tracking parent changes WIDTH. A ResizeObserver catches any layout change (the window, a flex container, a container query), not just a window resize, and reports at once rather than after a wait, so --ps-max-height keeps up with the current width.
	// It watches the width, not the height, because writing a height is what this code does, and it would set itself off again.
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
			// No deepLink, so clear out any old ?panel= ids an opening left behind.
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
		// The URL always counts: a ?panel=id link is explicit and belongs to this page, so a shareable link works with no config.
		const fromUrl = this._parsePanelParam();
		if (fromUrl) return fromUrl;
		// localStorage only counts if you ask for it, so an old entry cannot push aside the .active panel in your markup unless this set persists.
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

	// Gather this set's own [role="tabpanel"] panels. querySelectorAll reaches all the way down, so an outer set would otherwise claim a nested set's panels. closest() keeps only panels whose nearest panelset or panel container is this element.
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
		if (this.config.manageLabels) this._reflectLabels();
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
				const active = panel === activePanel;

				// aria-selected only means anything on a role="tab" inside a tablist, where every tab carries it, true or false. Anything else (a nav, a plain row of buttons) gets aria-current on the active one and nothing on the rest.
				const isTab = trigger.getAttribute('role') === 'tab' && !!trigger.closest('[role="tablist"]');
				if (isTab) {
					trigger.setAttribute('aria-selected', String(active));
					trigger.removeAttribute('aria-current');
				} else {
					if (active) trigger.setAttribute('aria-current', 'true');
					else trigger.removeAttribute('aria-current');
					trigger.removeAttribute('aria-selected');
				}
			});
		});
	}

	// Name each panel after the trigger that controls it: the [aria-controls] link read backwards. This is structure, not state, so it runs at init and on refresh, never on activation.
	// It never overrides a name the panel already has, and only acts when a single trigger clearly owns the panel.
	private _reflectLabels(): void {
		this.panels.forEach(panel => {
			if (!panel.id) return;
			if (panel.hasAttribute('aria-labelledby') || panel.hasAttribute('aria-label')) return;

			const triggers = Array.from(
				document.querySelectorAll<HTMLElement>(`[aria-controls="${panel.id}"]`)
			);
			if (triggers.length === 0) return;

			// When several controls point at one panel (a tab and a remote button, say), take the single role="tab". Otherwise there must be exactly one trigger.
			const tabs = triggers.filter(t => t.getAttribute('role') === 'tab');
			const labelling = tabs.length === 1 ? tabs[0]
				: triggers.length === 1 ? triggers[0]
				: null;
			if (!labelling) return; // too many to choose from, so leave the naming to you

			if (!labelling.id) labelling.id = this._uniqueId(`${panel.id}-tab`);
			panel.setAttribute('aria-labelledby', labelling.id);
		});
	}

	// A document-unique id derived from a base, for a generated trigger id.
	private _uniqueId(base: string): string {
		let id = base, n = 2;
		while (document.getElementById(id)) id = `${base}-${n++}`;
		return id;
	}

	private _setTriggersActivating(active: boolean): void {
		this.panels.forEach(panel => {
			if (!panel.id) return;
			document.querySelectorAll<HTMLElement>(`[aria-controls="${panel.id}"]`).forEach(trigger => {
				trigger.classList.toggle('is-activating', active);
			});
		});
	}

	// Reflect a panel's async loading onto every trigger pointing at it.
	
	private _setTriggersLoading(panelId: string, loading: boolean): void {
		if (!this.config.manageTriggers || !panelId) return;
		document.querySelectorAll<HTMLElement>(`[aria-controls="${panelId}"]`).forEach(trigger => {
			trigger.classList.toggle('is-trigger-loading', loading);
			if (loading) trigger.setAttribute('aria-busy', 'true');
			else trigger.removeAttribute('aria-busy');
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

		// Note where it is before taking the other class off, so turning round halfway carries on from where it stands, not from the start.
		const isReversing = this.element.classList.contains(oppositeClass);
		const reverseStartHeight = isReversing ? this.element.offsetHeight : null;

		// Take the open height BEFORE is-open comes off. A closable set is closed by default (height 0 without .is-open), so the moment the class goes, so does the height. Read it later and you get 0, the close runs 0 to 0, and nothing happens. This is the real starting height.
		const closeStartHeight = !isOpening ? this.element.offsetHeight : null;

		this.element.classList.remove(oppositeClass);
		if (!isOpening) this.element.classList.remove('is-open');

		if (isOpening) this.element.removeAttribute('inert');

		// Come to rest closed, and give focus back.
		const settleClosed = () => {
			this.element.setAttribute('inert', '');
			const byPointer = event instanceof PointerEvent && event.pointerType !== '';
			if (this.config.returnFocus && this._returnFocusTarget && !byPointer) {
				this._returnFocusTarget.focus();
			}
		};

		if (withTransition && this.config.transitions) {
			// Exactly as Panel does it. The animation runs under .is-opening or .is-closing alone, and the wrapper is never pinned. The wrapper reveal lives in CSS and starts from whatever is committed now, so a click halfway through just swaps the class and the browser carries on from where things are. .is-open goes on only once it settles, and the height:auto while opening comes from the @supports rule.
			this.element.classList.add(actionClass);

			if (PanelSet._nativeInterpolateSize) {
				if (isOpening) {
					this.element.style.height = reverseStartHeight !== null ? `${reverseStartHeight}px` : '0px';
					requestAnimationFrame(() => {
						this.element.style.height = ''; // .is-opening's height: auto takes over
						Core.waitForTransition(this.element, 'height').then(() => {
							if (signal.aborted) return;
							// Wait for the wrapper's transition too: its GPU layer holds the clip open in WebKit until it is done.
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
					// Pin it in pixels: interpolate-size alone cannot get Firefox from auto down to 0. Use the height taken before is-open came off, since the resting height is already 0.
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
				// Everywhere else the JS does it: measure, pin, animate, let go.
				const targetHeight = isOpening ? this._measureHeight(this.pendingPanel) : 0;
				// Opening starts from the height it has now, unless it is turning round out of a close. Closing starts from the height taken before is-open came off.
				const currentHeight = reverseStartHeight !== null
					? reverseStartHeight
					: (isOpening ? this.element.offsetHeight : (closeStartHeight ?? 0));
				this.element.style.height = `${currentHeight}px`;
				// Settle here, so the pinned Npx is committed before the rAF changes it. Without it the pin is wiped, Firefox gets auto and 0px in one go, which it cannot animate between, and the set jumps shut.
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
	 * The id of the panel that is active now.
	 * @returns the panel's id, or null when none is active.
	 */
	getActive(): string | null {
		return this.pendingPanel?.id || null;
	}

	/**
	 * Look at the DOM again and bring everything back into line: the active panel, the triggers, and the Prev/Next buttons at the ends.
	 * Call it after adding, removing or reordering [role="tabpanel"] elements at runtime, as a lazy or windowed wizard does. The active panel stays active if it is still there. If it has gone, the panel marked .active takes over, then the first one. New panels start hidden.
	 * Call it while the set is at rest, not mid-transition.
	 */
	refresh(): void {
		const previousActive = this.activePanel;
		this.panels = this._collectPanels();
		if (this.panels.length === 0) return;

		this.activePanel = (previousActive && this.panels.includes(previousActive))
			? previousActive
			: (this.panels.find(p => p.classList.contains('active')) ?? this.panels[0]);
		this.pendingPanel = this.activePanel;
		// A wrapper made at runtime (or the very first one) can differ from the one we kept.
		this.panelWrapper = this.element.querySelector<HTMLElement>(':scope > .panel-wrapper') || this.panelWrapper;

		this._internalInit();
		this._reflectEnds();   // add, remove or reorder can change which panel is first and last, so the buttons need to know
		this._log(`Refreshed (${this.panels.length} panels)`);
	}

	/**
	 * Add a panel at runtime, and refresh. It goes at the end of the wrapper unless you say where, and it is given role="tabpanel" if it has none.
	 * @param panel - the [role="tabpanel"] element to add.
	 * @param position - { before } or { after } the id of a panel already there, or { index }.
	 * @returns the panel you passed in.
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
	 * Take a panel out by id, and refresh.
	 * @param panelId - the id of the panel to remove.
	 */
	removePanel(panelId: string): void {
		const panel = this.panels.find(p => p.id === panelId);
		if (!panel) return;
		panel.remove();
		this.refresh();
	}

	/**
	 * Destroy this instance
	 */
	destroy(): void {
		this._animShow.start();       // drop any .then() still waiting: they all check signal.aborted
		this._animOpenClose.start();
		this._heightObserver?.disconnect();
		this._heightObserver = null;
		this._verbController.abort();  // stop keeping the buttons in step; the shared click listener finds no .panelSet and does nothing anyway
		delete this.element.panelSet;
		this._log('Destroyed');
	}

	// Where the targeted panel (pendingPanel) sits in the run of panels, to send with the event.
	private _edgeInfo(panel: HTMLElement | undefined): { index: number; total: number; atStart: boolean; atEnd: boolean } {
		const total = this.panels.length;
		const index = panel ? this.panels.indexOf(panel) : -1;
		return { index, total, atStart: index <= 0, atEnd: index === total - 1 };
	}

	/* --- Verb buttons (data-ps-next / -prev / -close) --- */

	// Markup shorthand for next(), prev() and close(). One click listener on the document drives every set's buttons. Delegation is necessary, not tidiness: these buttons often sit inside panel content loaded later, which does not exist at init. It goes on once and every set shares it.
	private static _installVerbDelegation(): void {
		if (PanelSet._verbDelegationInstalled) return;
		PanelSet._verbDelegationInstalled = true;
		document.addEventListener('click', PanelSet._onVerbClick);
	}

	// Find the set a button drives. Naming one, as data-ps-next="#wizard" does, always wins. Otherwise it is the nearest set around it.
	private static _resolveVerbSet(btn: HTMLElement, verb: 'next' | 'prev' | 'close'): HTMLElement | null {
		const sel = btn.getAttribute(`data-ps-${verb}`);
		if (sel) return document.querySelector<HTMLElement>(sel);
		return btn.closest<HTMLElement>('[data-panelset], ps-panelset');
	}

	private static _onVerbClick = (event: Event): void => {
		const start = event.target;
		if (!(start instanceof Element)) return;
		const btn = start.closest<HTMLElement>('[data-ps-next], [data-ps-prev], [data-ps-close]');
		// aria-disabled is what holds a button at the end. A natively disabled button never fires a click, so there is nothing more to check.
		if (!btn || btn.getAttribute('aria-disabled') === 'true') return;

		const verb: 'next' | 'prev' | 'close' =
			btn.hasAttribute('data-ps-next') ? 'next' :
			btn.hasAttribute('data-ps-prev') ? 'prev' : 'close';

		const setEl = PanelSet._resolveVerbSet(btn, verb);
		const instance = setEl?.panelSet;
		if (!instance) {
			// The same note PanelControl gives when nothing is initialised. With no instance there is no config, so this reads data-debug off the set element.
			if (setEl) log('PanelSet', setEl, setEl.dataset.debug != null && setEl.dataset.debug !== 'false',
				`data-ps-${verb}: PanelSet is not initialised. Add a PanelSet.init().`);
			return;
		}
		instance[verb]({ event });
	};

	// Start keeping this set's buttons in step with the ends, and set them as they should be now. The clicks are handled for every set at once (see _installVerbDelegation); this only keeps aria-disabled honest.
	private _initVerbButtons(): void {
		const { signal } = this._verbController;
		this.element.addEventListener('ps:activationstart', this._onActivationEdge, { signal });
		this.element.addEventListener('ps:activationcomplete', this._onActivationEdge, { signal });
		this._reflectEnds();
	}

	// Work out which panel is first and last from the panels there are now, and set the buttons to match. Runs at init and on refresh(), so adding, removing or reordering keeps Prev and Next right. Without it, a panel added at the end leaves the old last step's Next stuck disabled until the next activation.
	// An activation does not come through here: it uses the flags the event carries (see _onActivationEdge).
	private _reflectEnds(): void {
		const { atStart, atEnd } = this._edgeInfo(this.pendingPanel);
		this._reflectVerbEndState(atStart, atEnd);
	}

	// Runs on both activationstart and activationcomplete. The flags ride on the event and describe the panel being AIMED AT (pendingPanel), which is the one _step() steps from. Following pendingPanel, not activePanel, keeps the buttons agreeing with the guard through fast clicks and reversals.
	private _onActivationEdge = (e: Event): void => {
		const { atStart, atEnd } = (e as CustomEvent<ActivationEventDetail>).detail;
		this._reflectVerbEndState(atStart, atEnd);
	};

	// The prev and next buttons at the ends: prev goes off on the first panel, next on the last. With loop on there are no ends, so neither is ever turned off.
	//
	// 'aria' (the default): toggles aria-disabled, never the real disabled attribute, which is yours. The button stays reachable, so nothing has to be done about focus.
	//
	// 'native': PanelSet owns the real disabled attribute here, since it has to switch them back on as you step away from an end, and aria-disabled is left to you. Disabling the element that has focus drops focus onto <body>, so focus is moved first.
	private _reflectVerbEndState(atStart: boolean, atEnd: boolean): void {
		if (this.config.loop) return;
		const prev = this._verbButtonsFor('prev');
		const next = this._verbButtonsFor('next');

		if (this.config.disabledMode !== 'native') {
			prev.forEach(b => this._applyVerbDisabled(b, atStart));
			next.forEach(b => this._applyVerbDisabled(b, atEnd));
			return;
		}

		// Switch buttons back on first, which never moves focus, so the other one is ready to take it before an end button goes off.
		if (!atStart) prev.forEach(b => this._applyVerbDisabled(b, false));
		if (!atEnd)   next.forEach(b => this._applyVerbDisabled(b, false));
		// Now turn the end button off. Focus goes to the button facing the other way, but only if it is still usable and not at its own end.
		if (atStart) this._disableVerbNative(prev, atEnd   ? [] : next);
		if (atEnd)   this._disableVerbNative(next, atStart ? [] : prev);
	}

	// Put the disabled state on one button, in whichever mode is set, and keep its hint (data-ps-disabled-hint) in step. The hint joins aria-describedby only while the button is off, so nobody hears it while the button works.
	// Turning off a button that holds focus goes through _disableVerbNative, which moves focus and then calls this.
	private _applyVerbDisabled(btn: HTMLElement, disabled: boolean): void {
		if (this.config.disabledMode === 'native') {
			if (disabled) btn.setAttribute('disabled', ''); else btn.removeAttribute('disabled');
		} else {
			btn.setAttribute('aria-disabled', String(disabled));
		}
		const hint = btn.getAttribute('data-ps-disabled-hint');
		if (hint) setDescribedBy(btn, hint, disabled);
	}

	// Turn buttons off in native mode. Before switching off one that holds focus, move focus to the first working button facing the other way, or else to the active panel, so it never falls onto <body>.
	private _disableVerbNative(buttons: HTMLElement[], counterparts: HTMLElement[]): void {
		buttons.forEach(btn => {
			if (!btn.hasAttribute('disabled') && document.activeElement === btn) {
				const target = counterparts.find(c => !c.hasAttribute('disabled')) ?? this._verbFocusFallback();
				target?.focus();
			}
			this._applyVerbDisabled(btn, true);
		});
	}

	// Where focus goes when no other button can take it: the panel the user is on (pendingPanel during a switch, else activePanel). Made focusable the same way autoFocus: true does.
	private _verbFocusFallback(): HTMLElement | null {
		const panel = this.pendingPanel ?? this.activePanel;
		if (!panel) return null;
		if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
		return panel;
	}

	// Every data-ps-prev and data-ps-next button belonging to this set, whether it sits inside it or names it from elsewhere with data-ps-next="#sel".
	private _verbButtonsFor(verb: 'prev' | 'next'): HTMLElement[] {
		return Array.from(document.querySelectorAll<HTMLElement>(`[data-ps-${verb}]`))
			.filter(btn => PanelSet._resolveVerbSet(btn, verb) === this.element);
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
	 * Go to the panel before this one, in DOM order. It stops at the first, unless `loop` is on, and then it comes round to the last.
	 * @param options - the options for this activation.
	 */
	prev(options?: ShowOptions): void {
		this._step(-1, options);
	}

	private _step(dir: 1 | -1, options?: ShowOptions): void {
		const total = this.panels.length;
		if (total === 0) return;
		// Step from the panel being aimed at, so quick clicks queue up properly.
		const from = this.panels.indexOf(this.pendingPanel);
		const current = from === -1 ? 0 : from;
		let target = current + dir;
		let wrapped = false;
		if (target < 0 || target >= total) {
			if (!this.config.loop) return;     // clamp at the ends
			target = (target + total) % total; // wrap
			wrapped = true;
		}
		const next = this.panels[target];
		// Only a step that comes round the end needs telling which way it goes: the DOM order points the other way (last to first reads as backwards), so trust the step. An ordinary step already agrees with the DOM order.
		if (next && next !== this.pendingPanel)
			this.show(next.id, wrapped ? { ...options, direction: dir > 0 ? 'forward' : 'backward' } : options);
	}


	/**
	 * Open a closable panelset.
	 * @param options - the options for this open.
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

		// Work out which button was pressed, so its data attributes can be read.
		const resolvedTrigger = event?.target instanceof HTMLElement 
			? (event.target.closest('button, a, [role="tab"]') as HTMLElement) ?? event.target
			: null;

		const finalAutoFocus = this._resolveAutoFocus(resolvedTrigger, autoFocus);
		if (resolvedTrigger) this._returnFocusTarget = resolvedTrigger;

		this._animateOpenClose(true, transition);
		
		// Focus goes in once it is open.
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
	 * Close a closable panelset.
	 * @param options - the options for this close.
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
	 * Open a closable panelset if it is closed, close it if it is open.
	 * @param options - the options for this activation.
	 */
	toggle(options?: ShowOptions): void {
		const {
			event,
			transition = true,
			autoFocus
		} = options || {};

		const isClosed = this._isClosed;
		const isClosing = this.element.classList.contains('is-closing');

		// Closed, or on its way there, so open it.
		if (isClosed || isClosing) {
			// Pass it to open(), which already knows what beats what
			this.open({ event, transition, autoFocus });
		} else {
			this.close({ transition, event });
		}
	}

	/**
	 * Register a function that fetches the content.
	 * @param handler - the function that gets the content.
	 * @param options - once: load it a single time and no more.
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
	 * Show a panel, by id.
	 * @param panelId - the id of the panel to show.
	 * @param options - the options for this activation.
	 */
	async show(panelId: string, options?: ShowOptions): Promise<void> {
		if (this.config.interruptible === false && this._activating) return;

		const {
			event,
			transition = true,
			autoFocus,
			direction: stepDirection
		} = options || {};

		// The trigger always comes from the event.
		const resolvedTrigger = event?.target instanceof HTMLElement 
			? (event.target.closest('button, a, [role="tab"]') as HTMLElement) ?? event.target
			: null;

		const finalAutoFocus = this._resolveAutoFocus(resolvedTrigger, autoFocus);

		const newPanel = this.panels.find(p => p.id === panelId);

		if (!newPanel) {
			this._log(`Panel not found: ${panelId}`);
			return;
		}

		// The gate, fired before anything has changed. preventDefault() on it and the activation does not happen, which is how a wizard holds someone on a step until the fields are filled in. Every path goes through show(), so this covers a tab click, next() and prev(), and a deep link alike.
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
				// Same panel, but the set is closed or closing, so open it.
				this.open({ event, transition, autoFocus: finalAutoFocus });
			} else if (this.config.closable && this.config.closeOnTab) {
				// A click on the already-active tab while the set is open. With closeOnTab on, that closes it.
				this.close({ transition, event });
			}
			return;
		}

		// No switching tabs while the set is opening or closing, though loading is fine.
		if ((this.element.classList.contains('is-opening') || isClosing) && !isLoading) return;

		// Closed: swap quietly to the panel asked for, then open.
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

		// Turning back: a switch is still running and the user has asked again for the panel on its way out (activePanel). So the panel that was coming in (prevPanel) becomes the one going out, the direction flips, and the CSS transition rolls back from where the panels actually are.
		const isReversal = switchInFlight && newPanel === this.activePanel && prevPanel !== newPanel;
		if (this.config.manageTriggers) this._updateTabTriggers(newPanel);

		this._persistState(panelId);

		this.element.classList.remove('is-loading');

		if (!isReversal && prevPanel && prevPanel !== this.activePanel && prevPanel !== newPanel) {
			prevPanel.classList.remove('incoming', 'outgoing', 'levelup', 'leveldown');
			if (prevPanel.hidden) {
				// It was never on screen, so leave it hidden.
			} else {
				prevPanel.classList.remove('active');
			}
		}

		const wasLoadingAsync = this._isLoadingAsync;

		// start() cancels the signal before it, stopping the running animation and any fetch() that was given that signal through ps:beforeopen.
		const prevSignalAborted = this._animShow.signal.aborted;
		const signal = this._animShow.start();

		if (!prevSignalAborted && wasLoadingAsync && prevPanelId && prevPanelId !== panelId) {
			// A new switch interrupts a load still running on another panel. Stop that panel's trigger spinning now, rather than wait for the old activation to unwind.
			this._setTriggersLoading(prevPanelId, false);
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
			promise: null,
			waitUntil() {} // wired below; closes over the detail so it is safe to destructure
		};
		attachWaitUntil(beforeOpenDetail);

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

			// is-loading goes on at once, so the wrapper dims and nothing flashes.
			// The spinner is held back by a CSS transition-delay (--ps-loading-delay), which keeps it off quick loads with no timer in the JS.
			this.element.style.setProperty('--ps-loading-delay', `${this.config.loadingDelay}ms`);
			this.element.classList.add('is-loading');
			this._setTriggersLoading(panelId, true);

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
					// loadingHeight is a floor, not a size: grow to it only if the set is already shorter.
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
					this._setTriggersLoading(panelId, false);
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
				this._setTriggersLoading(panelId, false);
				this.element.style.removeProperty('--ps-loading-delay');

				if (err.name !== 'AbortError') {
					console.error('Panel load error:', error);
				}

				this._activating = false;
				if (this.config.manageTriggers && this.config.interruptible === false) this._setTriggersActivating(false);
				return;
			}

			this.element.classList.remove('is-loading');
			this._setTriggersLoading(panelId, false);
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

		// Which way it travels (levels). The DOM order is the level: a later panel is higher. Going higher is levelup, lower is leveldown. With levels off, no direction class is set and everything slides the default way.
		let direction: 'levelup' | 'leveldown' | null = null;
		if (isReversal) {
			// The opposite of the way it was going. A plain slide (no levels) always runs the default way, levelup, so its reverse is leveldown.
			direction = this._switchDirection === 'leveldown' ? 'levelup' : 'leveldown';
		} else if (this.config.levels && outgoingPanel && outgoingPanel !== newPanel) {
			// next() and prev() say which way they go, so coming round the end still slides the way you were heading ('forward' looks like Next). Left to the DOM order, a wrap from last to first slides backwards. A jump straight to a panel (a tab click) says nothing, so it falls back to the DOM order.
			if (stepDirection) {
				direction = stepDirection === 'forward' ? 'levelup' : 'leveldown';
			} else {
				const fromIdx = this.panels.indexOf(outgoingPanel);
				const toIdx   = this.panels.indexOf(newPanel);
				if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
					direction = toIdx > fromIdx ? 'levelup' : 'leveldown';
				}
			}
		}
		this._switchDirection = direction;

		// Clear out whatever an interrupted switch left behind, right now, so the CSS transitions carry on from where the panels are instead of snapping.
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

		// Two rAFs. The first frame commits the incoming panel at opacity 0, the second adds active (opacity 1) so the fade runs. With only one, Firefox skips the transition and shows the new panel at full opacity at once.
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