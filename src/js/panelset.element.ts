import { PanelSet } from './panelset.js';
import type { PanelSetConfig } from './panelset.types.js';
import { parseAttrs } from './functions/config.js';

export class PanelSetElement extends HTMLElement {
	connectedCallback(): void {
		if (this.panelSet) return;
		const options = parseAttrs<PanelSetConfig>(this, PanelSet.attrs);
		new PanelSet(this, options);
	}

	disconnectedCallback(): void {}
}
