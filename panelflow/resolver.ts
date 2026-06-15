import type { Answers, StepDef } from './types';

/**
 * The LOGICAL next step id, given a step and the answers so far — or `null` when the
 * step is terminal (no `next`) or no edge matches.
 *
 * The only place that interprets a step's `next`. Pure: no DOM, no async, no library
 * imports. Order of precedence: a matched case wins; otherwise `default`; otherwise
 * `null` (terminal, or a branch with no matching case and no fallback).
 */
export function resolve(step: StepDef, answers: Answers = {}): string | null {
	const next = step.next;
	if (!next) return null; // terminal: no outgoing edge
	if (next.field && next.cases) {
		const value = answers[next.field];
		const key = value == null ? undefined : String(value);
		if (key !== undefined && key in next.cases) return next.cases[key];
	}
	return next.default ?? null;
}
