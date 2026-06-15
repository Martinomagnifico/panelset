// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { PanelSet } from '../src/js/panelset';

// Phase 5 library fix: refresh() (hence addPanel/removePanel) re-syncs the verb
// buttons' end-of-range state — so a windowed flow that materialises/removes panels
// keeps Prev/Next correct without waiting for the next activation.
describe('PanelSet.refresh re-reflects verb-button ends', () => {
	beforeEach(() => { document.body.innerHTML = ''; });

	it('addPanel after the last step un-dims Next', () => {
		document.body.innerHTML = `
			<div id="set" data-panelset>
				<div class="panel-wrapper">
					<div id="p1" role="tabpanel" hidden></div>
					<div id="p2" role="tabpanel" hidden></div>
					<div id="p3" role="tabpanel" class="active"></div>
				</div>
			</div>
			<button data-ps-next="#set">Next</button>`;
		const [set] = PanelSet.init('#set');
		const next = document.querySelector('[data-ps-next]')!;
		expect(next.getAttribute('aria-disabled')).toBe('true'); // active is last → disabled

		const p4 = document.createElement('div');
		p4.id = 'p4';
		p4.setAttribute('role', 'tabpanel');
		p4.hidden = true;
		set.addPanel(p4); // old last (p3) is no longer the end

		expect(next.getAttribute('aria-disabled')).toBe('false');
	});

	it('inits empty and promotes the first added panel (windowed flows)', () => {
		document.body.innerHTML = `<div id="empty" data-panelset><div class="panel-wrapper"></div></div>`;
		const [set] = PanelSet.init('#empty');
		expect(set.getActive()).toBeNull();

		const p = document.createElement('div');
		p.id = 'first';
		p.setAttribute('role', 'tabpanel');
		set.addPanel(p);
		expect(set.getActive()).toBe('first');
	});

	it('removePanel that makes the current panel last dims Next', () => {
		document.body.innerHTML = `
			<div id="set2" data-panelset>
				<div class="panel-wrapper">
					<div id="q1" role="tabpanel" class="active"></div>
					<div id="q2" role="tabpanel" hidden></div>
				</div>
			</div>
			<button data-ps-next="#set2">Next</button>`;
		const [set] = PanelSet.init('#set2');
		const next = document.querySelector('[data-ps-next]')!;
		expect(next.getAttribute('aria-disabled')).toBe('false'); // first of two → enabled

		set.removePanel('q2'); // q1 is now the only/last panel
		expect(next.getAttribute('aria-disabled')).toBe('true');
	});
});
