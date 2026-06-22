export { PanelSet } from './panelset.js';
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
} from './panelset.types.js';

export { Panel } from './panel.js';
export type {
	PanelConfig,
	// Aliased: PanelSet also exports a (differently shaped) BeforeOpenEventDetail.
	BeforeOpenEventDetail as PanelBeforeOpenEventDetail,
	PanelEventDetail,
	AsyncOpenHandler,
} from './panel.types.js';

export { PanelControl } from './panelcontrol.js';
export type { PanelControlConfig } from './panelcontrol.types.js';

import { PanelElement } from './panel.element.js';
import { PanelSetElement } from './panelset.element.js';
import { PanelControlElement, registerPanelControl } from './panelcontrol.element.js';
export { PanelElement, PanelSetElement, PanelControlElement, registerPanelControl };


export function register(prefix = 'ps'): void {
	const define = (name: string, ctor: CustomElementConstructor) => {
		if (!customElements.get(name)) customElements.define(name, ctor);
	};
	define(`${prefix}-panel`, PanelElement);
	define(`${prefix}-panelset`, PanelSetElement);
	define(`${prefix}-panelcontrol`, PanelControlElement);
}

export { PanelSet as default } from './panelset.js';
