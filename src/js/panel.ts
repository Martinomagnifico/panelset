import '../style/panelset.scss';
import { Core } from './functions/core.js';
import { autoFocus } from './functions/focus.js';
import { readPanelParam, writePanelParam, readStored, writeStored } from './functions/persist.js';
import { findBody, lockBody, unlockBody } from './functions/pinning.js';

import type { PanelConfig, BeforeOpenEventDetail, PanelEventDetail, PanelStaticEventDetail, AsyncOpenHandler } from './panel.types.js';
import { parseDataAttrs, type AttrMap } from './functions/config.js';
import { log, logInterpolateSizeOnce, registerBeforeOpenHandler, attachWaitUntil } from './functions/utils.js';

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

	// Static = not a disclosure right now: expanded content, no inert, no trigger semantics. Driven by the `static` option, or forced with setStatic().
	private _static = false;
	private _mql: MediaQueryList | null = null;
	private _onMqlChange: (() => void) | null = null;

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
		customIndicator: false,
		interruptible: true,
		persist: false,
		deepLink: false,
		static: false,
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
		customIndicator: ['panelCustomIndicator', 'boolean'],
		interruptible:  ['panelInterruptible',  'boolean'],
		persist:        ['panelPersist',        'boolean'],
		deepLink:       ['panelDeeplink',       'boolean'],
		// Read as a string and sorted out in _normalizeStatic: the value is either a boolean ("", "true", "false") or a media query.
		static:         ['panelStatic',         'string'],
		debug:          ['debug',               'boolean'],
	};

	// True when the browser supports interpolate-size: allow-keywords. When set, CSS animates height/width 0 to/from auto natively and the JS measure-animate cycle is skipped (open/close just toggle state classes).

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

		// Implicit trigger wiring (a [data-panel-trigger] button next to its panel) is handled per-instance in the constructor. See _wireImplicitTriggers. So it works for Panel.init(), the <ps-panel> web component, and any panel constructed directly, not just [data-panel] in this one pass.

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

		// Precedence: defaults < init() options < per-element data-attributes. The attribute is the most specific signal, so it wins. This lets an element opt out of a global flag, e.g. data-panel-persist="false" overriding Panel.init({ persist: true }).
		const dataConfig = parseDataAttrs<PanelConfig>(element.dataset, Panel.attrs);
		this.config = { ...Panel.defaults, ...options, ...dataConfig };

		if (this.config.axis === 'horizontal') element.dataset.panelAxis = 'horizontal';
		if (this.config.align !== 'start') element.dataset.panelAlign = this.config.align;

		// This is what stops the library showing its own spinner. It reflects the RESOLVED config, so the CSS cannot read the authored attribute directly (data-panel-custom-indicator="false" is present but means false). The rule then stops MATCHING rather than merely hiding: a hidden ::after still carries all its declarations, so the author could not reuse the pseudo-element without unpicking every one.
		if (this.config.customIndicator) element.setAttribute('data-ps-custom-indicator', '');

		this._wireImplicitTriggers();
		this._bindTriggers();

		// A media query is watched for the lifetime of the instance (torn down in destroy). This has to resolve before the initial-state branch below, because static REPLACES open/closed rather than being one of them.
		this.config.static = this._normalizeStatic(this.config.static);
		if (typeof this.config.static === 'string') {
			this._mql = window.matchMedia(this.config.static);
			this._onMqlChange = () => this._applyStatic(this._mql!.matches);
			this._mql.addEventListener('change', this._onMqlChange);
		}

		if (this.config.static === true || (this._mql && this._mql.matches)) {
			this._applyStatic(true, { initial: true });
		} else if (this._resolveInitialState() || this.element.classList.contains('is-open')) {
			// Start open if persisted/deep-linked state says so, OR if the markup was authored with .is-open. Either way snap open without animation and sync the trigger's aria-expanded, so hand-authored markup needs no extra ARIA.
			this.element.classList.add('is-open');
			this.element.removeAttribute('inert');
			this._setTriggerState(true);
			// is-restored is there for exactly one paint, so CSS can hold back transitions on whatever sits around the panel. Two rAFs make sure it survives that paint.
			this.element.classList.add('is-restored');
			requestAnimationFrame(() => requestAnimationFrame(() => this.element.classList.remove('is-restored')));
			this._dispatch('panel:opened');
		} else {
			this.element.setAttribute('inert', '');
			// A closed disclosure's trigger says so, whether it was hand-authored with [aria-controls] or wired implicitly.
			this._setTriggerState(false);
		}

		if (Panel._nativeInterpolateSize) logInterpolateSizeOnce(this.config.debug);
		this._log('Initialized');
	}

	// Bare `data-panel-static` (or "true") means always static, "false" means never, anything else is a media query the panel is static WHILE it matches.
	private _normalizeStatic(value: boolean | string): boolean | string {
		if (typeof value === 'boolean') return value;
		const v = value.trim();
		if (v === '' || v === 'true') return true;
		if (v === 'false') return false;
		return v;
	}

	// How the panel finds its triggers. A trigger is normally found by its aria-controls, which is all a panel has ever needed.
	// A STATIC panel is the exception: it takes aria-controls off the trigger (a button that controls nothing must not say it does), and then the query would lose sight of the very button it has to hand the attribute back to. So a static panel stamps its own hook first, data-ps-for="<panel id>", and is found by that. The hook lives in the DOM, so unlike a JS reference it survives a re-render, and the query stays live, so a trigger added later is still found.
	// It lives exactly as long as aria-controls is missing: written on the way into static, taken off again on the way out. An ordinary panel never carries one.
	private _triggers(): HTMLElement[] {
		const id = this.element.id;
		if (!id) return [];
		return Array.from(
			document.querySelectorAll<HTMLElement>(`[data-ps-for="${id}"], [aria-controls="${id}"]`)
		);
	}

	// Write the hook, just before aria-controls is taken away.
	private _stampTriggers(triggers: HTMLElement[]): void {
		const id = this.element.id;
		if (!id) return;
		triggers.forEach(t => { if (t.dataset.psFor !== id) t.dataset.psFor = id; });
	}

	// A panel labelled by its own trigger (the usual accordion pattern) keeps that name when it turns static, because a name taken through aria-labelledby is still read from an element that CSS has hidden. That is the one place hidden text still counts.
	// So nothing breaks, and the panel is NOT stripped of its label: an unnamed region would be worse than a stale name. But the panel is now named after a button that is no longer on the page, so say so while debugging.
	private _warnLabelledByTrigger(triggers: HTMLElement[]): void {
		if (!this.config.debug) return;
		const labelledBy = this.element.getAttribute('aria-labelledby');
		if (!labelledBy || this.element.hasAttribute('aria-label')) return;

		const ids = labelledBy.split(/\s+/).filter(Boolean);
		const triggerIds = new Set(triggers.map(t => t.id).filter(Boolean));
		if (!ids.length || !ids.every(id => triggerIds.has(id))) return;

		this._log(`Static, but aria-labelledby points only at this panel's trigger, which is now hidden. The name still resolves, but it names a button nobody can see. Give the panel its own aria-label, or point aria-labelledby at a heading inside it.`);
	}

	// Switch between "collapsible disclosure" and "plain expanded content". Never animates: a resize across the breakpoint should not look like an open.
	private _applyStatic(next: boolean, opts: { initial?: boolean } = {}) {
		if (!opts.initial && next === this._static) return;
		this._static = next;

		this._anim.start(); // abort anything in flight; its .then() checks the signal
		this.element.classList.remove('is-opening', 'is-closing', 'is-loading');
		this.element.style[this._cssProp()] = '';
		const body = findBody(this.element);
		if (body) unlockBody(body);

		if (next) {
			// Not a disclosure: open, reachable, and the trigger stops claiming ANYTHING about the panel. aria-expanded goes, because there is no expanding left to describe, and aria-controls goes with it, because the button no longer controls this panel. The stylesheet hides that button, but hiding is CSS and you can take it back to reuse the button, so the semantics can never lean on it.
			this.element.classList.add('is-open');
			this.element.removeAttribute('inert');
			this.element.setAttribute('data-ps-static', '');
			const triggers = this._triggers();
			this._stampTriggers(triggers); // the hook goes on BEFORE aria-controls comes off, or they cannot be found again
			triggers.forEach(t => {
				t.setAttribute('data-ps-static', '');
				t.removeAttribute('aria-expanded');
				t.removeAttribute('aria-controls');
			});
			this._warnLabelledByTrigger(triggers);
		} else {
			// Collapsible again, and it lands CLOSED: a drawer that reappears already open over the content is never what you want.
			this.element.classList.remove('is-open');
			this.element.setAttribute('inert', '');
			this.element.removeAttribute('data-ps-static');
			const id = this.element.id;
			this._triggers().forEach(t => {
				t.removeAttribute('data-ps-static');
				if (id) t.setAttribute('aria-controls', id);
				t.removeAttribute('data-ps-for'); // aria-controls is back, so the hook has nothing left to do
				t.setAttribute('aria-expanded', 'false');
			});
		}

		this._log(next ? 'Static' : 'Collapsible');

		if (!opts.initial) {
			const detail: PanelStaticEventDetail = { static: next };
			this.element.dispatchEvent(new CustomEvent('panel:staticchange', { detail, bubbles: true }));
		}
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

	// Work out persist and deepLink, closest thing wins: the element's own attribute, then the group's, then the init option or default. So data-panel-persist="false" on the element keeps it out, even inside a [data-panel-group] that persists. An attribute counts as set by being there, and anything but "false" means true.
	private _resolveStateConfig = (): { persist: boolean; deepLink: boolean } => {
		// undefined means the element does not carry the attribute at all.
		const ownAttr = (name: string): boolean | undefined =>
			this.element.hasAttribute(name)
				? this.element.getAttribute(name) !== 'false'
				: undefined;

		const ownPersist = ownAttr('data-panel-persist');
		const ownDeepLink = ownAttr('data-panel-deeplink');

		// The closest group around it, stopping at any [data-panel] on the way up.
		let groupPersist: boolean | undefined;
		let groupDeepLink: boolean | undefined;
		let el = this.element.parentElement;
		while (el) {
			if (el.hasAttribute('data-panel')) break;
			if (el.hasAttribute('data-panel-group')) {
				if (el.hasAttribute('data-panel-persist'))  groupPersist  = el.getAttribute('data-panel-persist')  !== 'false';
				if (el.hasAttribute('data-panel-deeplink')) groupDeepLink = el.getAttribute('data-panel-deeplink') !== 'false';
				break;
			}
			el = el.parentElement;
		}

		return {
			persist:  ownPersist  ?? groupPersist  ?? this.config.persist,
			deepLink: ownDeepLink ?? groupDeepLink ?? this.config.deepLink,
		};
	};

	private _persistState = (open: boolean): void => {
		if (!this.element.id) return;
		// A static panel is neither open nor closed in any way worth remembering, so it writes nothing to localStorage or the URL.
		if (this._static) return;

		const { persist: hasPersist, deepLink: hasDeepLink } = this._resolveStateConfig();

		if (hasPersist) {
			writeStored(`panel:${this.element.id}`, open ? 'open' : 'closed');
		}

		if (hasDeepLink) {
			this._updatePanelParam(open);
		} else if (!open && this._parsePanelParam()) {
			// No deepLink, but a close still clears an old ?panel= id, or the URL would keep opening the panel again.
			this._updatePanelParam(false);
		}
	};

	private _resolveInitialState = (): boolean => {
		const { id } = this.element;
		if (!id) return false;
		// The URL always counts: a ?panel=id link is explicit and belongs to this page, so a shareable link works with no config.
		if (this._parsePanelParam()) return true;
		// localStorage only counts if you ask for it. Without persist, an old entry (an id the library handed out itself, left by another page) must not open this panel.
		const { persist } = this._resolveStateConfig();
		if (persist && readStored(`panel:${id}`) === 'open') return true;
		return false;
	};

	private _cssProp = (): 'height' | 'width' =>
		this.config.axis === 'horizontal' ? 'width' : 'height';


	// Turn a [data-panel-trigger] button next to the panel into a real aria-controls trigger for THIS panel. It looks outward from the panel, not inward from the trigger, so it works however the panel is written (a [data-panel] div or a <ps-panel>) and however it is built, not only through init().
	// The panel gets an id of its own only once a trigger needs one to point at.
	private _wireImplicitTriggers() {
		const isPanel = (el: HTMLElement): boolean => el.hasAttribute('data-panel') || !!el.panel;
		const wire = (trigger: HTMLElement): void => {
			if (!this.element.id) this.element.id = `panel-${++Panel._autoIdCounter}`;
			trigger.setAttribute('aria-controls', this.element.id);
			if (!trigger.hasAttribute('aria-expanded')) trigger.setAttribute('aria-expanded', 'false');
			trigger.removeAttribute('data-panel-trigger');
		};
		// The trigger can be the sibling itself, or sit inside a heading beside the panel: <h2><button data-panel-trigger>…</button></h2>.
		const triggerIn = (el: HTMLElement): HTMLElement | null =>
			el.hasAttribute('data-panel-trigger') ? el
			: /^H[1-6]$/.test(el.tagName) ? el.querySelector<HTMLElement>(':scope > [data-panel-trigger]')
			: null;
		// Nearest trigger on each side, without crossing into another panel.
		for (const dir of ['previousElementSibling', 'nextElementSibling'] as const) {
			let el = this.element[dir] as HTMLElement | null;
			while (el && !isPanel(el)) {
				const trigger = triggerIn(el);
				if (trigger) { wire(trigger); break; }
				el = el[dir] as HTMLElement | null;
			}
		}
	}

	private _bindTriggers() {
		const id = this.element.id;
		if (!id) return;
		const { signal } = this._listenerController;

		// _triggers() rather than a raw [aria-controls] query, so a trigger the panel already stamped (it was static, and lost its aria-controls) is bound too.
		this._triggers().forEach(trigger => {
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
		if (this._static) return; // a static panel's trigger says nothing about it
		this._triggers().forEach(t => t.setAttribute('aria-expanded', String(open)));
	}

	// Reflect the async loading state onto the trigger as well.

	private _setTriggersLoading(loading: boolean) {
		this._triggers().forEach(t => {
			t.classList.toggle('is-trigger-loading', loading);
			if (loading) t.setAttribute('aria-busy', 'true');
			else t.removeAttribute('aria-busy');
		});
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

		// A static sibling is not a disclosure, so it is never "an open panel" that should be closed to make room for this one.
		const toClose: HTMLElement[] = group
			? trueSiblings(this.element, {
				groupSelector: '[data-panel-group]',
				itemSelector:  '[data-panel]',
				filter:        el => !!el.panel?.isOpen && !el.panel.isStatic,
			})
			: Array.from(this.element.parentElement?.children ?? [])
				.filter((el): el is HTMLElement =>
					el instanceof HTMLElement && el !== this.element && !!el.panel?.isOpen && !el.panel.isStatic
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

	/** True when the panel is plain expanded content rather than a disclosure. */
	get isStatic(): boolean {
		return this._static;
	}

	/**
	 * Put the panel into its static, always-open state, or take it out, whatever the `static` media query says.
	 * For breakpoints the library cannot see: a container query, your own breakpoint system, a feature flag.
	 */
	setStatic(value: boolean): void {
		this._applyStatic(value);
	}


	// open

	async open(event?: Event) {
		if (this._static) return this._log('open() ignored: panel is static');
		if (this.isOpen && !this.element.classList.contains('is-closing')) return;
		if (this.config.interruptible === false && this._activating) return;

		this._activating = true;
		const signal  = this._anim.start();
		const cssProp = this._cssProp();

		const beforeOpenDetail: BeforeOpenEventDetail = {
			signal,
			promise: null,
			waitUntil() {}, // wired below; closes over the detail so it is safe to destructure
			trigger: this._returnFocusTarget
		};
		attachWaitUntil(beforeOpenDetail);

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
		contentPromise: Promise<unknown>,
		event?:         Event
	) {
		// Race the content against loadingDelay. If the content wins, phase 1 is skipped: no spinner, no loadingHeight.
		const contentFirst = await Promise.race([
			contentPromise.then(() => true as const),
			new Promise<false>(res => {
				const t = setTimeout(() => res(false), this.config.loadingDelay);
				signal.addEventListener('abort', () => clearTimeout(t));
			}),
		]).catch(() => false as const);

		if (signal.aborted) return;

		if (contentFirst) {
			// The content beat loadingDelay, so open like any other panel.
			this._openSync(signal, cssProp, event);
			return;
		}

		// The slow way: loadingDelay ran out and the content is not here.
		// is-loading goes on BEFORE anything forces the styles to settle. If the wrapper already sits at opacity 1 (the panel was open before) when is-opening arrives, that gives it a 1-to-0 opacity transition and the old content stays in view all through phase 1. is-loading first pins the wrapper at opacity 0, and nothing transitions.
		
		this.element.classList.remove('is-closing');
		this.element.removeAttribute('inert');
		this.element.classList.add('is-loading');
		this._setTriggersLoading(true);

		// Throw the old content out, or it walks back in the moment is-loading comes off.
		this.element.querySelector(':scope > .panel-wrapper')?.replaceChildren();

		// The JS already sat through loadingDelay, so the spinner shows at once.
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
			// An abort, or the content failed. Either way, fall through to the signal check below.
		} finally {
			this.element.classList.remove('is-loading');
			this._setTriggersLoading(false);
			this.element.style.removeProperty('--ps-loading-delay');
		}

		if (signal.aborted) return;

		// Phase 2: run from the loading height to the height the content needs.
		const currentRect = this.element.getBoundingClientRect();
		const current = cssProp === 'height' ? currentRect.height : currentRect.width;
		this.element.style[cssProp] = '';

		if (this.config.transitions) {
			if (Panel._nativeInterpolateSize) {
				// The inline value is gone, so the @supports block gives it height:auto and the browser runs from the loading height to whatever the content comes to.
				Core.waitForTransition(this.element, cssProp).then(() => {
					if (signal.aborted) return;
					this.element.classList.remove('is-opening');
					this.element.classList.add('is-open');
					this._dispatch('panel:opened');
					this._log('Opened');
					this._handleAutoFocus(event);
				});
			} else {
				// Everywhere else the JS does it: measure, put the loading height back, animate.
				// It says 'auto' before measuring, because the base CSS says height:0 and a cleared inline style would measure 0.
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
				// Pin the size BEFORE closing the siblings, so when a sibling's close() settles the layout it already sees this panel at 0px, not at its full open height. Skip it and the settle wipes the 0px, leaving the run to auto with no distance to cover.
				this.element.classList.add('is-opening');
				this.element.style[cssProp] = reverseStartSize !== null ? `${reverseStartSize}px` : '0px';
				if (body) lockBody(body);
				void getComputedStyle(this.element)[cssProp]; // make the 0px stick before the siblings force a settle

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
				// Everywhere else the JS does it: measure, pin at 0 (or wherever a reversed close left it), run to the target, clear the inline value at the end.
				// It says 'auto' first so getBoundingClientRect reports the size the content wants. The base CSS says height:0, so otherwise the target measures 0.
				this.element.style[cssProp] = 'auto';

				const rect   = this.element.getBoundingClientRect();
				const target = cssProp === 'height' ? rect.height : rect.width;

				this.element.style[cssProp] = reverseStartSize !== null ? `${reverseStartSize}px` : '0px';
				this.element.classList.add('is-opening');
				if (body) lockBody(body);
				// Settle here, so Firefox has the pinned size committed before the rAF.
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
	 * Register a function that fetches the content before the panel opens. It gets the panel element and an AbortSignal. Return a promise and the panel waits for it before opening.
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
		if (this._static) return this._log('close() ignored: panel is static');
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
		// Settle here, so Firefox has { is-closing, height: Npx } committed. Without it the rAF overwrites the pin, Firefox gets auto and 0px in one go, which it cannot animate between, and the panel jumps shut.
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
		if (this._static) return this._log('toggle() ignored: panel is static');
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
	 * Take this instance apart: listeners off, element back to how it was, and element.panel cleared so Panel.init() can pick it up again.
	 */
	destroy() {
		this._anim.start(); // pending .then() callbacks check signal.aborted
		this._listenerController.abort();

		if (this._mql && this._onMqlChange) {
			this._mql.removeEventListener('change', this._onMqlChange);
			this._mql = null;
			this._onMqlChange = null;
		}
		// Hand the triggers back as they were found: aria-controls returned (a panel destroyed while static would otherwise leave its button hidden and pointing at nothing), and the library's own hook taken off again.
		const id = this.element.id;
		this._triggers().forEach(t => {
			t.removeAttribute('data-ps-static');
			if (id && !t.hasAttribute('aria-controls')) t.setAttribute('aria-controls', id);
			t.removeAttribute('data-ps-for');
		});
		this._static = false;
		this.element.removeAttribute('data-ps-static');

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
