import type { PanelControlConfig } from './panelcontrol.types.js';
import type { ShowOptions } from './panelset.types.js';
import { parseDataAttrs, type AttrMap } from './functions/config.js';
import { log, setDescribedBy } from './functions/utils.js';

declare global {
	interface HTMLElement {
		panelControl?: PanelControl;
	}
}

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
	 * Start up every PanelControl container the selector finds.
	 * @param selectorOrOptions - a CSS selector, or a config object.
	 * @param options - the config, when the first argument was a selector.
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

		// What beats what: defaults, then init() options, then the element's own data attributes.
		const dataConfig = parseDataAttrs<PanelControlConfig>(element.dataset, PanelControl.attrs);
		this.config = { ...PanelControl.defaults, ...options, ...dataConfig } as Required<Omit<PanelControlConfig, 'selector'>>;

		this._isTablist = element.getAttribute('role') === 'tablist';
		this._bindTriggers();
		if (this._isTablist) this._setupKeyboard();

		// A first look for the PanelSet. If it is there, the parts that need it are set up now. The getter tries again later, so a PanelSet that turns up after init is still found.
		const linked = this.panelSetElement;

		this._log(`Initialized (${linked ? 'linked to a PanelSet' : 'no PanelSet found yet'}${this._isTablist ? ', tablist keyboard nav' : ''})`);
	}

	/**
	 * The PanelSet container this control drives. Looked up on first use and then kept, so a PanelSet that lands in the DOM after init is still found.
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
	 * Lock a tab, or let it go again. PanelControl applies the state it is given and never decides WHEN a tab should be locked: that is the caller's job (a flow controller, say).
	 * 'disabled' sets aria-disabled, so the keyboard skips the tab and neither a click nor Enter activates it. 'enabled' takes it off.
	 * A tab can carry data-pc-disabled-hint="hintId". That hint joins aria-describedby only while the tab is locked, so a tab you can still reach can say why it will not budge.
	 * @param panelId - the aria-controls id of the tab or tabs to change.
	 * @param state - 'enabled' or 'disabled'.
	 */
	setTabState(panelId: string, state: 'enabled' | 'disabled'): void {
		const disabled = state === 'disabled';
		this.element.querySelectorAll<HTMLElement>(`[aria-controls="${panelId}"]`).forEach(tab => {
			tab.setAttribute('aria-disabled', String(disabled));
			const hint = tab.getAttribute('data-pc-disabled-hint');
			if (hint) setDescribedBy(tab, hint, disabled);
			if (this._isTablist && disabled) tab.tabIndex = -1; // a locked tab cannot hold the tab stop
		});
		// If the locked tab held the tab stop, give it to one that still works.
		if (this._isTablist && disabled) this._ensureRovingStop();
	}

	// ---- Internals --------------------------------------------------------

	private _log(msg: string) { log('PanelControl', this.element, this.config.debug, msg); }

	// Put [data-closeable] on the control when the set closes on a second click (closable + closeOnTab). CSS can then keep the active trigger clickable: a pointer-events:none on the active tab would swallow the very click that closes it. It reads the merged config where it can, and falls back to the set element's attributes before the set has started.
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

	// Find the PanelSet element. Naming one with data-panelcontrol="#sel" wins, which is handy for a set elsewhere on the page, or one that arrives late. Otherwise it follows the first trigger: aria-controls gives a panel, and the panel's nearest panelset container is the set. That is what lets the control sit anywhere in the DOM. One PanelControl drives one PanelSet.
	private _resolvePanelSet(): HTMLElement | null {
		const target = this.element.getAttribute('data-panelcontrol');
		if (target) return document.querySelector<HTMLElement>(target);

		const trigger = this.element.querySelector<HTMLElement>('[aria-controls]');
		const panelId = trigger?.getAttribute('aria-controls');
		if (!panelId) return null;
		const panel = document.getElementById(panelId);
		return panel?.closest<HTMLElement>('[data-panelset], ps-panelset') ?? null;
	}

	// Set up the parts that need the PanelSet element, once it is found. That can be long after init, on the first click.
	private _onElementResolved(el: HTMLElement): void {
		const { signal } = this._controller;
		// Keep the tab stop in step whenever the set activates a panel, by click or from code.
		if (this._isTablist && !this._activationWired) {
			el.addEventListener('ps:activationcomplete', this._onActivation as EventListener, { signal });
			this._activationWired = true;
		}
		// Reflect closeable now, and look again once the set is ready.
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

	// Activate the panel a trigger points at, and move the tab stop with it. A locked trigger never activates anything.
	private _activate(trigger: HTMLElement, event: Event) {
		if (trigger.getAttribute('aria-disabled') === 'true') return;
		const panelId = trigger.getAttribute('aria-controls');
		if (!panelId) return;
		// The PanelSet does the switching. If it is not there, a missing PanelSet.init() is the likeliest reason, so say so rather than do nothing.
		if (!this.panelSet) {
			this._log(`Can’t activate '${panelId}': its PanelSet is not initialised. Add a PanelSet.init().`);
			return;
		}
		this.panelSet.show(panelId, { event });   // the set is looked up on first use
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

	// Make sure a working tab holds the tab stop, which matters just after the tab that held it was locked. It takes the active tab, or the first working one.
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
		// The tab stop starts on the tab marked selected, or on the first one.
		const active = tabs.find(t => t.getAttribute('aria-selected') === 'true') ?? tabs[0];
		this._setRoving(active);
		this.element.addEventListener('keydown', this._onKeydown, { signal: this._controller.signal });
		// Keeping the tab stop in step with ps:activationcomplete happens in _onElementResolved, once the PanelSet element is known, which can be after init.
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
				// Activate whichever tab has focus. This is for tabs that are not buttons: a real button fires a click itself, but taking it here too does no harm and keeps them alike.
				if (idx >= 0) { e.preventDefault(); this._activate(tabs[idx], e); }
				return;
			default: return;
		}

		if (!target) return;
		e.preventDefault();
		this._setRoving(target);
		target.focus();
		// 'auto' activation, but only where it does no harm.
		if (this._autoActivate()) this._activate(target, e);
	};

	// 'auto' falls back to manual wherever activating on an arrow press would work against the user: autoFocus drags focus into the panel, async content sets off a load per keystroke.
	private _autoActivate(): boolean {
		return this.config.activation === 'auto'
			&& !this._autoFocusInPlay()
			&& !this.panelSet?.hasAsyncContent;
	}

	// autoFocus can sit on the PanelSet (config, data-auto-focus, or the web component attribute) or on a single trigger. Any one of them rules 'auto' out.
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

	/** Take every listener off again and let go of the element. */
	destroy() {
		this._controller.abort();
		delete this.element.panelControl;
		this._log('Destroyed');
	}
}

export default PanelControl;
