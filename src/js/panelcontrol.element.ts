import { PanelControl } from './panelcontrol.js';
import type { PanelControlConfig } from './panelcontrol.types.js';
import { parseAttrs } from './functions/config.js';

export class PanelControlElement extends HTMLElement {
	connectedCallback(): void {
		if (this.panelControl) return;
		const options = parseAttrs<PanelControlConfig>(this, PanelControl.attrs);
		new PanelControl(this, options);
	}

	disconnectedCallback(): void {}
}

/**
 * Register the <ps-panelcontrol> custom element.
 * @param prefix - the name to put in front. Defaults to 'ps', giving <ps-panelcontrol>.
 */
export function registerPanelControl(prefix = 'ps'): void {
	const name = `${prefix}-panelcontrol`;
	if (!customElements.get(name)) customElements.define(name, PanelControlElement);
}
