// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { FlowController, type PanelSetLike } from './controller';
import { inMemoryLoader } from './loader';
import { branchingFlow } from './fixtures';
import type { StepDef } from './types';

// A fake that honours the PanelSet public surface the controller depends on, so the
// orchestration logic is tested without the real PanelSet's transition machinery.
// (Real integration is exercised by the docs demo in phase 6.)
class FakeSet implements PanelSetLike {
	element = document.createElement('div');
	wrapper = document.createElement('div');
	panels: HTMLElement[] = [];
	active: string | null = null;
	shown: string[] = [];
	// Model a no-transition set: show() "completes" immediately, firing the event the
	// controller prunes on.
	show(id: string) {
		this.active = id;
		this.shown.push(id);
		this.element.dispatchEvent(new CustomEvent('ps:activationcomplete'));
	}
	getActive() { return this.active; }
	addPanel(panel: HTMLElement) { this.wrapper.appendChild(panel); this.panels.push(panel); return panel; }
	removePanel(id: string) {
		const p = this.panels.find(x => x.id === id);
		if (p) { p.remove(); this.panels = this.panels.filter(x => x !== p); }
	}
	ids() { return this.panels.map(p => p.id); }
}

const render = (step: StepDef): HTMLElement => {
	const el = document.createElement('div');
	el.setAttribute('role', 'tabpanel');
	el.textContent = step.title ?? step.id;
	return el;
};

const make = (answers: Record<string, unknown> = {}) => {
	const set = new FakeSet();
	const fc = new FlowController(set, inMemoryLoader(branchingFlow), { render, answers });
	return { set, fc };
};

describe('FlowController', () => {
	it('start materialises and shows the entry', async () => {
		const { set, fc } = make();
		await fc.start('q1');
		expect(set.ids()).toEqual(['q1']);
		expect(set.getActive()).toBe('q1');
	});

	it('advance resolves → materialises → shows, keeping a [prev, current] window', async () => {
		const { set, fc } = make({ path: 'a' });
		await fc.start('q1');
		await fc.advance(); // q1 → q2a
		expect(set.getActive()).toBe('q2a');
		expect(set.ids()).toEqual(['q1', 'q2a']);
		await fc.advance(); // q2a → done
		expect(set.getActive()).toBe('done');
		expect(set.ids()).toEqual(['q2a', 'done']); // q1 pruned out of the window
	});

	it('back re-activates the popped panel', async () => {
		const { set, fc } = make({ path: 'a' });
		await fc.start('q1');
		await fc.advance(); // q2a
		await fc.advance(); // done
		await fc.back();    // back to q2a
		expect(set.getActive()).toBe('q2a');
		expect(set.ids()).toContain('q2a');
	});

	it('follows the b branch straight to done (never materialises q2a)', async () => {
		const { set, fc } = make({ path: 'b' });
		await fc.start('q1');
		await fc.advance(); // q1 → done
		expect(set.getActive()).toBe('done');
		expect(set.ids()).not.toContain('q2a');
	});

	it('re-materialises a pruned panel when backing onto it', async () => {
		const { set, fc } = make({ path: 'a' });
		await fc.start('q1');
		await fc.advance(); // q2a
		await fc.advance(); // done (q1 pruned)
		expect(set.ids()).not.toContain('q1');
		await fc.back();    // q2a
		await fc.back();    // q1 — pruned earlier, must be re-added before showing
		expect(set.getActive()).toBe('q1');
		expect(set.ids()).toContain('q1');
	});
});
