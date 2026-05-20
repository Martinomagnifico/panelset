export { PanelSet } from './panelset';
export type {
	PanelSetConfig,
	ReadyEventDetail,
	BeforeOpenEventDetail,
	ActivationEventDetail,
	ActivationAbortedEventDetail,
	HandlerOptions,
	ShowOptions,
	AsyncContentHandler,
} from './panelset.types';

export { Panel } from './panel';
export type { PanelConfig } from './panel.types';

import { PanelElement } from './panel.element';
import { PanelSetElement } from './panelset.element';
export { PanelElement, PanelSetElement };

/**
 * Register the custom element wrappers.
 * Call with no argument to use the default 'ps' prefix ('ps-panel', 'ps-panelset').
 * Call with a custom prefix to avoid name collisions ('acme-panel', 'acme-panelset').
 * Safe to call multiple times: uses customElements.get() guard before each define().
 */
export function register(prefix = 'ps'): void {
	const panelName    = `${prefix}-panel`;
	const panelSetName = `${prefix}-panelset`;
	if (!customElements.get(panelName))    customElements.define(panelName,    PanelElement);
	if (!customElements.get(panelSetName)) customElements.define(panelSetName, PanelSetElement);
}

export { PanelSet as default } from './panelset';
