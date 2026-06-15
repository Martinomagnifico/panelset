// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { PanelSet } from '../src/js/panelset';
import { FlowController } from './controller';
import { inMemoryLoader } from './loader';
import { branchingFlow } from './fixtures';
import type { StepDef } from './types';

const render = (step: StepDef): HTMLElement => {
	const el = document.createElement('div');
	el.setAttribute('role', 'tabpanel');
	el.innerHTML = `<h3>${step.title ?? step.id}</h3>`;
	return el;
};

// Flush the double-rAF + microtasks that PanelSet.show() uses (transitions off → it
// resolves on Promise.resolve() inside the rAF chain).
const tick = () =>
	new Promise<void>((res) =>
		requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 0))));

describe('FlowController + real PanelSet (jsdom)', () => {
	it('advances q1 → q2a → done over an empty set', async () => {
		document.body.innerHTML = `<div id="s" data-panelset><div class="panel-wrapper"></div></div>`;
		const setEl = document.getElementById('s')!;
		const set = new PanelSet(setEl, { transitions: false });
		const fc = new FlowController(set, inMemoryLoader(branchingFlow), { render, answers: { path: 'a' } });

		await fc.start('q1');
		await tick();
		expect(set.getActive()).toBe('q1');

		await fc.advance();
		await tick();
		expect(set.getActive()).toBe('q2a');

		await fc.advance(); // q2a → done — the reported "does nothing" step
		await tick();
		expect(set.getActive()).toBe('done');
	});
});
