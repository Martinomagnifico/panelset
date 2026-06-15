import { describe, it, expect } from 'vitest';
import { resolve } from './resolver';
import { branchingFlow } from './fixtures';

const { q1, q2a, done } = branchingFlow.steps;

describe('resolve', () => {
	it('follows a matched case (path=a → q2a)', () => {
		expect(resolve(q1, { path: 'a' })).toBe('q2a');
	});

	it('follows the other case (path=b → done)', () => {
		expect(resolve(q1, { path: 'b' })).toBe('done');
	});

	it('returns null when no case matches and there is no default', () => {
		expect(resolve(q1, { path: 'nope' })).toBeNull();
		expect(resolve(q1, {})).toBeNull();
	});

	it('uses default for an unconditional edge (q2a → done)', () => {
		expect(resolve(q2a, {})).toBe('done');
		expect(resolve(q2a, { detail: 'whatever' })).toBe('done');
	});

	it('returns null for a terminal step (done)', () => {
		expect(resolve(done, { path: 'a' })).toBeNull();
	});
});
