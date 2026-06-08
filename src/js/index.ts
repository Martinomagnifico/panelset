export { PanelSet } from './panelset';
export type {
	PanelSetConfig,
	ReadyEventDetail,
	BeforeActivateEventDetail,
	BeforeOpenEventDetail,
	ActivationEventDetail,
	ActivationAbortedEventDetail,
	HandlerOptions,
	ShowOptions,
	AsyncContentHandler,
} from './panelset.types';

export { Panel } from './panel';
export type {
	PanelConfig,
	// Aliased: PanelSet also exports a (differently shaped) BeforeOpenEventDetail.
	BeforeOpenEventDetail as PanelBeforeOpenEventDetail,
	PanelEventDetail,
	AsyncOpenHandler,
} from './panel.types';

// PanelControl ships in this package and is available from the main entry. It is
// side-effect-free, so app bundlers tree-shake it out when you don't import it.
export { PanelControl } from './panelcontrol';
export type { PanelControlConfig } from './panelcontrol.types';

import { PanelElement } from './panel.element';
import { PanelSetElement } from './panelset.element';
import { PanelControlElement, registerPanelControl } from './panelcontrol.element';
export { PanelElement, PanelSetElement, PanelControlElement, registerPanelControl };

/**
 * Register the custom element wrappers: <ps-panel>, <ps-panelset>, <ps-panelcontrol>.
 * Call with no argument to use the default 'ps' prefix.
 * Call with a custom prefix to avoid name collisions ('acme-panel', …).
 * Safe to call multiple times: uses customElements.get() guard before each define().
 */
export function register(prefix = 'ps'): void {
	const define = (name: string, ctor: CustomElementConstructor) => {
		if (!customElements.get(name)) customElements.define(name, ctor);
	};
	define(`${prefix}-panel`, PanelElement);
	define(`${prefix}-panelset`, PanelSetElement);
	define(`${prefix}-panelcontrol`, PanelControlElement);
}

export { PanelSet as default } from './panelset';
