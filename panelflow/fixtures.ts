import type { FlowDef } from './types';

// Canonical branching fixture (test data for every phase):
//
//   q1 ──(path = a)──▶ q2a ──▶ done
//      └─(path = b)──────────▶ done
//
// q1 branches on the `path` answer; q2a advances unconditionally; done is terminal
// (no `next`). Small enough to reason about, branchy enough to exercise the resolver.
export const branchingFlow: FlowDef = {
	entry: 'q1',
	steps: {
		q1: {
			id: 'q1',
			title: 'Which path?',
			fields: [{
				name: 'path',
				type: 'radio',
				required: true,
				options: [
					{ value: 'a', label: 'Take the scenic route' },
					{ value: 'b', label: 'Skip to the end' },
				],
			}],
			next: { field: 'path', cases: { a: 'q2a', b: 'done' } },
		},
		q2a: {
			id: 'q2a',
			title: 'Scenic detail',
			fields: [{ name: 'detail', type: 'text', required: true }],
			next: { default: 'done' }, // unconditional edge
		},
		done: {
			id: 'done',
			title: 'All done',
			// no `next` → terminal
		},
	},
};
