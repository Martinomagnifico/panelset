import { describe, it, expect } from 'vitest';
import { inMemoryLoader } from './loader';
import { branchingFlow } from './fixtures';

describe('inMemoryLoader', () => {
	const load = inMemoryLoader(branchingFlow);

	it('loads a step by id', async () => {
		await expect(load('q2a')).resolves.toMatchObject({ id: 'q2a', title: 'Scenic detail' });
	});

	it('rejects an unknown id', async () => {
		await expect(load('nope')).rejects.toThrow(/no step "nope"/);
	});
});
