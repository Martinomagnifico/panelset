// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { loaderFromSource } from './sources';
import { branchingFlow } from './fixtures';

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
const notFound = () => ({ ok: false, status: 404, json: async () => null });

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

describe('loaderFromSource', () => {
	it('inline (#sel): parses JSON from the element and serves by id', async () => {
		document.body.innerHTML =
			`<script type="application/json" id="f">${JSON.stringify(branchingFlow)}</script>`;
		const load = loaderFromSource('#f');
		await expect(load('q2a')).resolves.toMatchObject({ id: 'q2a' });
	});

	it('inline: rejects when the element is missing', async () => {
		await expect(loaderFromSource('#nope')('q1')).rejects.toThrow(/no element/);
	});

	it('endpoint (:id): fetches one step per id', async () => {
		const fetchMock = vi.fn(async () => ok({ id: 'q2a', title: 'X' }));
		vi.stubGlobal('fetch', fetchMock);
		const load = loaderFromSource('/api/flow/:id');
		await expect(load('q2a')).resolves.toMatchObject({ id: 'q2a' });
		expect(fetchMock).toHaveBeenCalledWith('/api/flow/q2a');
	});

	it('endpoint: rejects on a non-ok response', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => notFound()));
		await expect(loaderFromSource('/api/flow/{id}')('zzz')).rejects.toThrow(/404/);
	});

	it('static file: fetches the whole flow once, then serves by id', async () => {
		const fetchMock = vi.fn(async () => ok(branchingFlow));
		vi.stubGlobal('fetch', fetchMock);
		const load = loaderFromSource('flow.json');
		await expect(load('q1')).resolves.toMatchObject({ id: 'q1' });
		await expect(load('done')).resolves.toMatchObject({ id: 'done' });
		expect(fetchMock).toHaveBeenCalledTimes(1); // cached after the first load
	});

	it('relative path (../flow.json) is a static file, not a CSS selector', async () => {
		const fetchMock = vi.fn(async () => ok(branchingFlow));
		vi.stubGlobal('fetch', fetchMock);
		const load = loaderFromSource('../flow.json');
		await expect(load('q1')).resolves.toMatchObject({ id: 'q1' });
		expect(fetchMock).toHaveBeenCalledWith('../flow.json');
	});
});
