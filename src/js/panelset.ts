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
	// Listeners for end-of-range reflection on this set's verb buttons; aborted on
	// destroy so a torn-down instance stops reflecting.
	private _verbController = new AbortController();

	private static readonly _nativeInterpolateSize =
		typeof CSS !== 'undefined' && CSS.supports('interpolate-size: allow-keywords');

	// One document-level click listener, shared across all PanelSet instances,
	// handles the verb buttons (data-ps-next / -prev / -close). Delegation (not
	// per-instance binding) is required because verb buttons commonly live inside
	// async-loaded panel content that does not exist at init. Installed lazily on
	// first construction — same spirit as logInterpolateSizeOnce.
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

		// Install the shared verb-button click delegation once (self-guards).
		PanelSet._installVerbDelegation();

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
			// An empty set is valid for dynamic / windowed flows that addPanel() their
			// panels later. Establish the wrapper so addPanel() has somewhere to insert;
			// activePanel / pendingPanel are assigned on the first add (via refresh()).
			this.panelWrapper =
				this.element.querySelector<HTMLElement>(':scope > .panel-wrapper') || this._autoWrapPanels();
			this._log('Initialized empty (0 panels) — ready for addPanel()');
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

		this._initVerbButtons();

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
				trigger.setAttribute('aria-selected', String(panel === activePanel));
			});
		});
	}

	// Auto-label each panel from the trigger that controls it (the reverse of the
	// [aria-controls] link). This is static structure, so it runs at init / refresh
	// only, never on activation. Conservative: it never overrides an existing
	// accessible name, and only acts when one trigger unambiguously controls the panel.
	private _reflectLabels(): void {
		this.panels.forEach(panel => {
			if (!panel.id) return;
			if (panel.hasAttribute('aria-labelledby') || panel.hasAttribute('aria-label')) return;

			const triggers = Array.from(
				document.querySelectorAll<HTMLElement>(`[aria-controls="${panel.id}"]`)
			);
			if (triggers.length === 0) return;

			// Prefer a single role="tab" when several controls point at this panel
			// (e.g. a tab plus a remote control); otherwise require exactly one trigger.
			const tabs = triggers.filter(t => t.getAttribute('role') === 'tab');
			const labelling = tabs.length === 1 ? tabs[0]
				: triggers.length === 1 ? triggers[0]
				: null;
			if (!labelling) return; // ambiguous — leave naming to the author

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
	 * Re-scan the DOM for this set's panels and reconcile internal state — the
	 * active panel, trigger state, and the Prev/Next end-of-range disabling. Call
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
		this._reflectEnds();   // add/remove/reorder may change first/last → re-sync verb buttons
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
	 * Remove a panel by id and refresh.
	 * @param panelId - ID of the panel to remove.
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
		this._animShow.start();       // abort pending .then() callbacks (they check signal.aborted)
		this._animOpenClose.start();
		this._heightObserver?.disconnect();
		this._heightObserver = null;
		this._verbController.abort();  // stop end-state reflection; the static click
		                               // delegation no-ops once .panelSet is gone
		delete this.element.panelSet;
		this._log('Destroyed');
	}

	// Edge info for the currently targeted panel (pendingPanel), for event detail.
	private _edgeInfo(panel: HTMLElement | undefined): { index: number; total: number; atStart: boolean; atEnd: boolean } {
		const total = this.panels.length;
		const index = panel ? this.panels.indexOf(panel) : -1;
		return { index, total, atStart: index <= 0, atEnd: index === total - 1 };
	}

	/* --- Verb buttons (data-ps-next / -prev / -close) --- */

	// Markup sugar over next() / prev() / close(): one document-level click
	// listener drives every set's verb buttons. Delegation is required (not a
	// nicety) — verb buttons commonly live inside async-loaded panel content that
	// does not exist at init. Installed once, shared by all instances.
	private static _installVerbDelegation(): void {
		if (PanelSet._verbDelegationInstalled) return;
		PanelSet._verbDelegationInstalled = true;
		document.addEventListener('click', PanelSet._onVerbClick);
	}

	// Resolve the set element a verb button drives. An explicit selector value —
	// data-ps-next="#wizard" — always wins; otherwise the nearest enclosing set.
	private static _resolveVerbSet(btn: HTMLElement, verb: 'next' | 'prev' | 'close'): HTMLElement | null {
		const sel = btn.getAttribute(`data-ps-${verb}`);
		if (sel) return document.querySelector<HTMLElement>(sel);
		return btn.closest<HTMLElement>('[data-panelset], ps-panelset');
	}

	private static _onVerbClick = (event: Event): void => {
		const start = event.target;
		if (!(start instanceof Element)) return;
		const btn = start.closest<HTMLElement>('[data-ps-next], [data-ps-prev], [data-ps-close]');
		// aria-disabled is our end-of-range guard; a native disabled button never
		// fires click, so there is nothing extra to check for that.
		if (!btn || btn.getAttribute('aria-disabled') === 'true') return;

		const verb: 'next' | 'prev' | 'close' =
			btn.hasAttribute('data-ps-next') ? 'next' :
			btn.hasAttribute('data-ps-prev') ? 'prev' : 'close';

		const setEl = PanelSet._resolveVerbSet(btn, verb);
		const instance = setEl?.panelSet;
		if (!instance) {
			// Same tone as PanelControl's "not initialised" notice. No instance means
			// no merged config, so gate the log on the set element's data-debug.
			if (setEl) log('PanelSet', setEl, setEl.dataset.debug != null && setEl.dataset.debug !== 'false',
				`data-ps-${verb}: PanelSet is not initialised. Add a PanelSet.init().`);
			return;
		}
		instance[verb]({ event });
	};

	// Wire end-of-range reflection for this set's verb buttons and stamp the
	// initial state. Clicks are handled globally (see _installVerbDelegation); here
	// we only keep aria-disabled in step with the ends.
	private _initVerbButtons(): void {
		const { signal } = this._verbController;
		this.element.addEventListener('ps:activationstart', this._onActivationEdge, { signal });
		this.element.addEventListener('ps:activationcomplete', this._onActivationEdge, { signal });
		this._reflectEnds();
	}

	// Recompute first/last from the current panels and re-apply the verb buttons'
	// end-of-range state. Run at init and on refresh() — so adding / removing /
	// reordering panels keeps Prev/Next correct (otherwise an appended panel leaves
	// the old last step's Next stuck disabled until the next activation). Activation
	// uses the event's own edge flags instead (see _onActivationEdge).
	private _reflectEnds(): void {
		const { atStart, atEnd } = this._edgeInfo(this.pendingPanel);
		this._reflectVerbEndState(atStart, atEnd);
	}

	// Reflect on both activationstart and activationcomplete. The edge flags ride
	// on the event detail and describe the *targeted* panel — i.e. pendingPanel,
	// which is what _step() steps from. Tracking pendingPanel (not activePanel)
	// keeps the button state agreeing with the guard during rapid interruptible
	// switches and reversals.
	private _onActivationEdge = (e: Event): void => {
		const { atStart, atEnd } = (e as CustomEvent<ActivationEventDetail>).detail;
		this._reflectVerbEndState(atStart, atEnd);
	};

	// End-of-range reflection on this set's prev/next buttons: prev is disabled at
	// the first panel, next at the last. With loop on, the ends wrap around, so the
	// buttons are never disabled — leave them alone in either mode.
	//
	// 'aria' (default): toggle aria-disabled, never the native disabled (the
	// author's). The button stays focusable, so no focus dance is needed.
	//
	// 'native': PanelSet owns the native disabled attribute on these buttons (it
	// must re-enable when stepping away from an end); aria-disabled is the author's
	// and untouched. Disabling the focused element drops focus to <body>, so the
	// focus dance moves focus off a button before disabling it.
	private _reflectVerbEndState(atStart: boolean, atEnd: boolean): void {
		if (this.config.loop) return;
		const prev = this._verbButtonsFor('prev');
		const next = this._verbButtonsFor('next');

		if (this.config.disabledMode !== 'native') {
			prev.forEach(b => this._applyVerbDisabled(b, atStart));
			next.forEach(b => this._applyVerbDisabled(b, atEnd));
			return;
		}

		// Re-enable first (never moves focus), so the counterpart is ready to
		// receive focus before we disable an end button.
		if (!atStart) prev.forEach(b => this._applyVerbDisabled(b, false));
		if (!atEnd)   next.forEach(b => this._applyVerbDisabled(b, false));
		// Then disable the end button(s). The counterpart is the opposite-direction
		// button, but only when it stays enabled (i.e. not also at its end).
		if (atStart) this._disableVerbNative(prev, atEnd   ? [] : next);
		if (atEnd)   this._disableVerbNative(next, atStart ? [] : prev);
	}

	// Apply the disabled state to one verb button per the configured mode, and keep
	// its aria-describedby hint (data-ps-disabled-hint) in step — the hint id is
	// attached only while the button is disabled, so it is not announced when the
	// button is usable. Native disabling that needs the focus dance routes through
	// _disableVerbNative, which calls this after moving focus.
	private _applyVerbDisabled(btn: HTMLElement, disabled: boolean): void {
		if (this.config.disabledMode === 'native') {
			if (disabled) btn.setAttribute('disabled', ''); else btn.removeAttribute('disabled');
		} else {
			btn.setAttribute('aria-disabled', String(disabled));
		}
		const hint = btn.getAttribute('data-ps-disabled-hint');
		if (hint) setDescribedBy(btn, hint, disabled);
	}

	// Disable verb `buttons` (native mode). Before disabling one that holds focus,
	// move focus to the first enabled counterpart, else to the active panel — so
	// focus never lands on <body>.
	private _disableVerbNative(buttons: HTMLElement[], counterparts: HTMLElement[]): void {
		buttons.forEach(btn => {
			if (!btn.hasAttribute('disabled') && document.activeElement === btn) {
				const target = counterparts.find(c => !c.hasAttribute('disabled')) ?? this._verbFocusFallback();
				target?.focus();
			}
			this._applyVerbDisabled(btn, true);
		});
	}

	// Fallback focus target when no enabled counterpart exists: the panel the user
	// is on (pendingPanel during a switch, else activePanel). Make it focusable the
	// same way autoFocus: true does.
	private _verbFocusFallback(): HTMLElement | null {
		const panel = this.pendingPanel ?? this.activePanel;
		if (!panel) return null;
		if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
		return panel;
	}

	// All data-ps-prev / data-ps-next buttons that resolve to this set — interior
	// (closest) and explicit-target (data-ps-next="#sel") alike.
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
		let wrapped = false;
		if (target < 0 || target >= total) {
			if (!this.config.loop) return;     // clamp at the ends
			target = (target + total) % total; // wrap
			wrapped = true;
		}
		const next = this.panels[target];
		// Only a loop wrap needs the direction hint: its DOM-order delta points the
		// wrong way (last->first looks backward), so honour the step's direction. A
		// normal step's DOM order already matches the action, so leave it alone.
		if (next && next !== this.pendingPanel)
			this.show(next.id, wrapped ? { ...options, direction: dir > 0 ? 'forward' : 'backward' } : options);
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
			autoFocus,
			direction: stepDirection
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
			// next()/prev() pass their step direction so a loop wrap slides in the
			// action's direction ('forward' = like Next), not the DOM-order delta —
			// which would slide a last->first wrap backwards. A direct jump (e.g. a tab
			// click) carries no intent, so it falls back to DOM order.
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