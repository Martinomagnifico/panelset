import { describe, it, expect } from 'vitest';
import { FlowEngine } from './engine';
import { inMemoryLoader } from './loader';
import { branchingFlow } from './fixtures';
import type { Answers } from './types';

const newEngine = (answers: Answers = {}) =>
	new FlowEngine(inMemoryLoader(branchingFlow), answers);

describe('FlowEngine', () => {
	it('starts at the entry: no previous, no resolvable next while unanswered', async () => {
		const e = newEngine();
		await e.start(branchingFlow.entry);
		expect(e.current.id).toBe('q1');
		expect(e.previousId).toBeNull();
		expect(e.canGoBack).toBe(false);
		expect(e.canAdvance).toBe(false);
	});

	it('advances along a branch (a → q2a → done) and tracks history', async () => {
		const e = newEngine();
		await e.start('q1');
		e.setAnswers({ path: 'a' });
		expect(e.nextId).toBe('q2a');
		expect(e.canAdvance).toBe(true);

		await e.advance();
		expect(e.current.id).toBe('q2a');
		expect(e.previousId).toBe('q1');
		expect(e.canGoBack).toBe(true);

		await e.advance(); // q2a → done (unconditional)
		expect(e.current.id).toBe('done');
		expect(e.previousId).toBe('q2a');
	});

	it('takes the other branch (b → done)', async () => {
		const e = newEngine({ path: 'b' });
		await e.start('q1');
		expect(e.nextId).toBe('done');
		await e.advance();
		expect(e.current.id).toBe('done');
		expect(e.previousId).toBe('q1');
	});

	it('cannot advance from a terminal step', async () => {
		const e = newEngine({ path: 'b' });
		await e.start('q1');
		await e.advance(); // done
		expect(e.canAdvance).toBe(false);
		await expect(e.advance()).rejects.toThrow(/cannot advance/);
	});

	it('goes back by popping history, restoring both extremes', async () => {
		const e = newEngine({ path: 'a' });
		await e.start('q1');
		await e.advance(); // q2a
		await e.advance(); // done
		await e.back();
		expect(e.current.id).toBe('q2a');
		await e.back();
		expect(e.current.id).toBe('q1');
		expect(e.canGoBack).toBe(false);
		await expect(e.back()).rejects.toThrow(/cannot go back/);
	});

	it('peekNext materialises the next step without advancing', async () => {
		const e = newEngine({ path: 'a' });
		await e.start('q1');
		const next = await e.peekNext();
		expect(next?.id).toBe('q2a');
		expect(e.current.id).toBe('q1');
	});

	it('reports the sliding window', async () => {
		const e = newEngine({ path: 'a' });
		await e.start('q1');
		expect(e.window).toEqual({ previousId: null, currentId: 'q1', nextId: 'q2a' });
		await e.advance();
		expect(e.window).toEqual({ previousId: 'q1', currentId: 'q2a', nextId: 'done' });
	});
});
