import { Panel } from './panel.js';
import type { PanelConfig } from './panel.types.js';
import { parseAttrs } from './functions/config.js';

export class PanelElement extends HTMLElement {
	connectedCallback(): void {
		if (this.panel) return;
		const options = parseAttrs<PanelConfig>(this, Panel.attrs);
		new Panel(this, options);
	}

	disconnectedCallback(): void {}
}
