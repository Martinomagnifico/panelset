import { describe, it, expect } from 'vitest';
import { branchingFlow } from './fixtures';

// Phase 1: the contract holds for the canonical fixture. (Type-level validity is
// checked by `tsc -p panelflow/tsconfig.json`; these assert structural integrity.)
describe('flow contract', () => {
	it('entry points at a real step', () => {
		expect(branchingFlow.steps[branchingFlow.entry]).toBeDefined();
	});

	it('every case/default target is a real step', () => {
		for (const step of Object.values(branchingFlow.steps)) {
			const n = step.next;
			if (!n) continue;
			const targets = [...Object.values(n.cases ?? {}), ...(n.default ? [n.default] : [])];
			for (const target of targets) {
				expect(branchingFlow.steps[target], `${step.id} → ${target}`).toBeDefined();
			}
		}
	});

	it('has at least one terminal step (no next)', () => {
		const terminals = Object.values(branchingFlow.steps).filter(s => !s.next);
		expect(terminals.map(s => s.id)).toContain('done');
	});
});
