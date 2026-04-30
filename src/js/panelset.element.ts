import { PanelSet } from './panelset';
import type { PanelSetConfig } from './panelset.types';
import { parseAttrs } from './functions/config';

export class PanelSetElement extends HTMLElement {
	connectedCallback(): void {
		if (this.panelSet) return;
		const options = parseAttrs<PanelSetConfig>(this, PanelSet.attrs);
		new PanelSet(this, options);
	}

	disconnectedCallback(): void {}
}
