import type { PanelControlConfig } from './panelcontrol.types';
import type { ShowOptions } from './panelset.types';
import { parseDataAttrs, type AttrMap } from './functions/config';
import { log } from './functions/utils';

declare global {
	interface HTMLElement {
		panelControl?: PanelControl;
	}
}

/*
 * PanelControl — an external controller for a PanelSet.
 * -----------------------------------------------------
 * A [data-panelcontrol] container holds the triggers (tabs, links, buttons)
 * that drive a single PanelSet. On click, the trigger's [aria-controls] target
 * is activated via the PanelSet instance's show().
 *
 * It finds its PanelSet through the panels the triggers point at, so the control
 * can live anywhere in the DOM — it does not need to be a sibling of the set.
 * One PanelControl drives exactly one PanelSet.
 *
 * When the control element is a [role="tablist"], it also provides the WAI-ARIA
 * tablist keyboard pattern: roving tabindex, arrow keys (orientation-aware),
 * Home/End, skipping disabled/hidden tabs. Non-tablist controls get click
 * wiring only (native Tab still works).
 */
export class PanelControl {
	static defaults: Required<Omit<PanelControlConfig, 'selector'>> = {
		activation: 'manual',
		debug: false,
	};

	static readonly attrs: AttrMap<PanelControlConfig> = {
		activation: ['activation', 'string'],
		debug: ['debug', 'boolean'],
	};

	element!: HTMLElement;
	config!: Required<Omit<PanelControlConfig, 'selector'>>;
	private _setEl: HTMLElement | null = null;
	private _controller = new AbortController();
	private _isTablist = false;
	private _activationWired = false;

	/**
	 * Initialise all PanelControl containers matching the selector.
	 * @param selectorOrOptions - CSS selector string or config object.
	 * @param options - Config (used when the first argument is a selector).
	 */
	static init(selectorOrOptions: string | PanelControlConfig = '[data-panelcontrol]', options: PanelControlConfig = {}): PanelControl[] {
		let selector: string;
		let config: PanelControlConfig;
		if (typeof selectorOrOptions === 'string') {
			selector = selectorOrOptions;
			config = options;
		} else {
			config = selectorOrOptions;
			selector = config.selector || '[data-panelcontrol]';
		}
		return Array.from(document.querySelectorAll<HTMLElement>(selector))
			.filter(el => !el.panelControl)
			.map(el => new PanelControl(el, config));
	}

	constructor(elementOrSelector: HTMLElement | string, options: PanelControlConfig = {}) {
		const element = typeof elementOrSelector === 'string'
			? document.querySelector<HTMLElement>(elementOrSelector)
			: elementOrSelector;
		if (!element) throw new Error(`PanelControl: No element found for selector "${elementOrSelector}"`);
		this.element = element;

		if (element.panelControl) {
			console.warn('PanelControl: already initialized');
			return element.panelControl;
		}
		element.panelControl = this;

		// Precedence: defaults < init() options < per-element data-attributes.
		const dataConfig = parseDataAttrs<PanelControlConfig>(element.dataset, PanelControl.attrs);
		this.config = { ...PanelControl.defaults, ...options, ...dataConfig } as Required<Omit<PanelControlConfig, 'selector'>>;

		this._isTablist = element.getAttribute('role') === 'tablist';
		this._bindTriggers();
		if (this._isTablist) this._setupKeyboard();

		// First resolution attempt now — wires the element-dependent bits (roving
		// sync, closeable reflection) if the PanelSet is already present. The getter
		// retries on later access, so a PanelSet added after init is picked up too.
		const linked = this.panelSetElement;

		this._log(`Initialized (${linked ? 'linked to a PanelSet' : 'no PanelSet found yet'}${this._isTablist ? ', tablist keyboard nav' : ''})`);
	}

	/**
	 * The PanelSet container this control drives. Resolved lazily on first access
	 * and then cached — so a PanelSet added to the DOM after init is still found.
	 */
	get panelSetElement(): HTMLElement | null {
		if (!this._setEl) {
			const el = this._resolvePanelSet();
			if (el) {
				this._setEl = el;
				this._onElementResolved(el);
			}
		}
		return this._setEl;
	}

	/** The live PanelSet instance this control drives, if initialised. */
	get panelSet() {
		return this.panelSetElement?.panelSet;
	}

	// ---- Public API -------------------------------------------------------

	/** Activate a tab's panel through the linked PanelSet. */
	show(panelId: string, options?: ShowOptions): void { this.panelSet?.show(panelId, options); }

	/**
	 * Lock or unlock a tab. PanelControl only applies the state it is told to
	 * apply — it does not decide *when* a tab should be locked (that is the
	 * caller's concern, e.g. a flow controller). 'disabled' sets aria-disabled so
	 * keyboard nav skips the tab and clicks / Enter no longer activate it;
	 * 'enabled' clears it.
	 * @param panelId - aria-controls target id of the tab(s) to update.
	 * @param state - 'enabled' or 'disabled'.
	 */
	setTabState(panelId: string, state: 'enabled' | 'disabled'): void {
		const disabled = state === 'disabled';
		this.element.querySelectorAll<HTMLElement>(`[aria-controls="${panelId}"]`).forEach(tab => {
			tab.setAttribute('aria-disabled', String(disabled));
			if (this._isTablist && disabled) tab.tabIndex = -1; // can't hold the roving stop
		});
		// If the disabled tab held the roving stop, hand it to an enabled tab.
		if (this._isTablist && disabled) this._ensureRovingStop();
	}

	// ---- Internals --------------------------------------------------------

	private _log(msg: string) { log('PanelControl', this.element, this.config.debug, msg); }

	// Reflect whether the linked set closes on re-click (closable + closeOnTab)
	// onto the control as [data-closeable]. CSS can use it to keep the active
	// trigger interactive — an active-tab pointer-events:none would otherwise
	// block re-click-to-close. Prefers the merged config (covers JS options and
	// data attributes); falls back to the set element's attributes pre-init.
	private _reflectCloseable = (): void => {
		const set = this.panelSet;
		const el = this.panelSetElement;
		let closeable = false;
		if (set) {
			closeable = !!(set.config.closable && set.config.closeOnTab);
		} else if (el) {
			const closable = el.dataset.closable != null || el.hasAttribute('closable');
			const onTab = el.dataset.closeOnTab != null || el.hasAttribute('close-on-tab');
			closeable = closable && onTab;
		}
		this.element.toggleAttribute('data-closeable', closeable);
	};

	// Resolve the PanelSet element. An explicit target — data-panelcontrol="#sel"
	// — wins (handy for remote or late-added sets). Otherwise discover it from the
	// first trigger's target panel: [aria-controls] → panel → nearest panelset
	// container, which is what lets the control sit anywhere in the DOM. One
	// PanelControl is linked to one PanelSet.
	private _resolvePanelSet(): HTMLElement | null {
		const target = this.element.getAttribute('data-panelcontrol');
		if (target) return document.querySelector<HTMLElement>(target);

		const trigger = this.element.querySelector<HTMLElement>('[aria-controls]');
		const panelId = trigger?.getAttribute('aria-controls');
		if (!panelId) return null;
		const panel = document.getElementById(panelId);
		return panel?.closest<HTMLElement>('[data-panelset], ps-panelset') ?? null;
	}

	// Wire the element-dependent bits, once — runs when the PanelSet element is
	// first resolved (which may be after init, on the first click).
	private _onElementResolved(el: HTMLElement): void {
		const { signal } = this._controller;
		// Keep roving in sync when the set activates a panel (click or programmatic).
		if (this._isTablist && !this._activationWired) {
			el.addEventListener('ps:activationcomplete', this._onActivation as EventListener, { signal });
			this._activationWired = true;
		}
		// Reflect closeable now; re-check once the instance is ready.
		this._reflectCloseable();
		if (!el.panelSet) {
			el.addEventListener('ps:ready', this._reflectCloseable, { once: true, signal });
		}
	}

	private _bindTriggers() {
		const { signal } = this._controller;
		this.element.querySelectorAll<HTMLElement>('[aria-controls]').forEach(trigger => {
			trigger.addEventListener('click', event => {
				this._activate(trigger, event);
			}, { signal });
		});
	}

	// Activate the panel a trigger controls, and keep roving tabindex in step.
	// Locked triggers (aria-disabled) never activate.
	private _activate(trigger: HTMLElement, event: Event) {
		if (trigger.getAttribute('aria-disabled') === 'true') return;
		const panelId = trigger.getAttribute('aria-controls');
		if (!panelId) return;
		// The PanelSet does the switching. If its instance isn't there, the most
		// likely cause is a missing PanelSet.init() — warn rather than no-op silently.
		if (!this.panelSet) {
			this._log(`Can’t activate '${panelId}': its PanelSet is not initialised. Add a PanelSet.init().`);
			return;
		}
		this.panelSet.show(panelId, { event });   // instance resolved lazily
		if (this._isTablist) this._setRoving(trigger);
	}

	// ---- Tablist keyboard pattern ----------------------------------------

	private _tabs(): HTMLElement[] {
		return Array.from(this.element.querySelectorAll<HTMLElement>('[role="tab"]'));
	}

	private _enabled = (tab: HTMLElement): boolean =>
		tab.getAttribute('aria-disabled') !== 'true' && !tab.hidden;

	// Roving tabindex: only the given tab is in the tab order.
	private _setRoving(active: HTMLElement) {
		this._tabs().forEach(tab => { tab.tabIndex = tab === active ? 0 : -1; });
	}

	// Make sure one enabled tab still holds the tab stop (e.g. after the tab that
	// held it was disabled). Prefers the active tab, else the first enabled one.
	private _ensureRovingStop() {
		const tabs = this._tabs();
		if (tabs.some(t => t.tabIndex === 0 && this._enabled(t))) return;
		const stop = tabs.find(t => t.getAttribute('aria-selected') === 'true' && this._enabled(t))
			?? tabs.find(this._enabled);
		if (stop) this._setRoving(stop);
	}

	private _setupKeyboard() {
		const tabs = this._tabs();
		if (!tabs.length) return;
		// Start with the marked-selected tab (or the first) as the tab stop.
		const active = tabs.find(t => t.getAttribute('aria-selected') === 'true') ?? tabs[0];
		this._setRoving(active);
		this.element.addEventListener('keydown', this._onKeydown, { signal: this._controller.signal });
		// The ps:activationcomplete roving sync is wired in _onElementResolved,
		// once the PanelSet element is known (it may resolve after init).
	}

	private _onActivation = (e: CustomEvent<{ panelId: string }>) => {
		const tab = this._tabs().find(t => t.getAttribute('aria-controls') === e.detail?.panelId);
		if (tab) this._setRoving(tab);
	};

	private _onKeydown = (e: KeyboardEvent) => {
		const tabs = this._tabs().filter(this._enabled);
		if (!tabs.length) return;

		const vertical = this.element.getAttribute('aria-orientation') === 'vertical';
		const nextKey = vertical ? 'ArrowDown' : 'ArrowRight';
		const prevKey = vertical ? 'ArrowUp' : 'ArrowLeft';

		const idx = tabs.indexOf(document.activeElement as HTMLElement);
		let target: HTMLElement | undefined;

		switch (e.key) {
			case nextKey: target = tabs[(idx + 1) % tabs.length]; break;
			case prevKey: target = tabs[(idx - 1 + tabs.length) % tabs.length]; break;
			case 'Home':  target = tabs[0]; break;
			case 'End':   target = tabs[tabs.length - 1]; break;
			case 'Enter':
			case ' ':
				// Activate the focused tab (covers non-<button> tabs; buttons would
				// fire click natively, but handling it here is harmless and uniform).
				if (idx >= 0) { e.preventDefault(); this._activate(tabs[idx], e); }
				return;
			default: return;
		}

		if (!target) return;
		e.preventDefault();
		this._setRoving(target);
		target.focus();
		// 'auto' activation, but only when it is safe to do so.
		if (this._autoActivate()) this._activate(target, e);
	};

	// 'auto' self-downgrades to manual when activating-on-arrow would fight the
	// user: autoFocus would yank focus into the panel, async content would fire
	// loads on every keystroke.
	private _autoActivate(): boolean {
		return this.config.activation === 'auto'
			&& !this._autoFocusInPlay()
			&& !this.panelSet?.hasAsyncContent;
	}

	// autoFocus can live on the PanelSet (config / data-auto-focus / web attr) or
	// on an individual trigger (data-auto-focus). Any of them makes auto unsafe.
	private _autoFocusInPlay(): boolean {
		const ps = this.panelSet;
		if (ps && ps.config.autoFocus !== false) return true;

		const set = this.panelSetElement;
		const setAttr = set && (set.dataset.autoFocus ?? set.getAttribute('auto-focus'));
		if (setAttr != null && setAttr !== 'false') return true;

		return this._tabs().some(tab => {
			const a = tab.getAttribute('data-auto-focus');
			return a != null && a !== 'false';
		});
	}

	/** Remove all listeners and drop the reference from the element. */
	destroy() {
		this._controller.abort();
		delete this.element.panelControl;
		this._log('Destroyed');
	}
}

export default PanelControl;
