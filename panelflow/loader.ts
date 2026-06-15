import type { FlowDef, StepDef } from './types';

/**
 * The single async seam: "where does a step's data come from". Inline, static-file
 * fetch, lazy step-by-step, a mocked endpoint, or a real API are all just
 * implementations of this signature. Orthogonal to the resolver — the resolver picks
 * an id, the loader fetches the data for that id.
 */
export type Loader = (id: string) => Promise<StepDef>;

/**
 * In-memory loader over a fully-known flow (the inline / static-file case). Rejects
 * on an unknown id so callers handle a missing step explicitly rather than silently.
 * The map key is authoritative for `id`, so steps need not repeat it inside.
 */
export function inMemoryLoader(flow: FlowDef): Loader {
	return async (id: string): Promise<StepDef> => {
		const step = flow.steps[id];
		if (!step) throw new Error(`PanelFlow: no step "${id}" in flow`);
		return { ...step, id };
	};
}
