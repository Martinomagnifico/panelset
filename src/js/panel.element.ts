import { Panel } from './panel';
import type { PanelConfig } from './panel.types';
import { parseAttrs } from './functions/config';

export class PanelElement extends HTMLElement {
	connectedCallback(): void {
		if (this.panel) return;
		const options = parseAttrs<PanelConfig>(this, Panel.attrs);
		new Panel(this, options);
	}

	disconnectedCallback(): void {}
}
