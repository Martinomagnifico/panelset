import { PanelControl } from './panelcontrol';
import type { PanelControlConfig } from './panelcontrol.types';
import { parseAttrs } from './functions/config';

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
 * @param prefix - Element name prefix. Defaults to 'ps' → <ps-panelcontrol>.
 */
export function registerPanelControl(prefix = 'ps'): void {
	const name = `${prefix}-panelcontrol`;
	if (!customElements.get(name)) customElements.define(name, PanelControlElement);
}
