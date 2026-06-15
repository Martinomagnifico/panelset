// PanelFlow flow contract (PREVIEW, incubating). Pure data shapes — no DOM, no
// imports, nothing from the panelset library. A step carries CONTENT keys (what
// PanelSet renders) and FLOW keys (what PanelFlow interprets); the two never mix
// downward. Terminal = a step with no `next`. Entry = the flow's first step.

/** A user's collected answers, keyed by field name. */
export type Answers = Record<string, unknown>;

/**
 * How to leave a step. The baseline is case-mapping on one field's answer, with
 * `default` covering the unmatched (or unconditional) case. The shape is left open
 * so a guard / expression form (e.g. a `when` list) can be added later WITHOUT a
 * schema break — but none of that is built yet. A step with NO `next` is terminal.
 */
export interface NextSpec {
	/** Answer field whose value selects a case. Omit for an unconditional edge. */
	field?: string;
	/** Map of answer value → next step id. */
	cases?: Record<string, string>;
	/** Next step id when no case matches, or when there is no field. */
	default?: string;
}

/** Minimal field shape used by the fixtures. CONTENT, not flow. */
export interface FieldDef {
	name: string;
	label?: string;
	type?: 'radio' | 'checkbox' | 'text';
	options?: { value: string; label: string }[];
	required?: boolean;
}

/**
 * One step.
 * FLOW keys: `id`, `next` — interpreted by PanelFlow.
 * CONTENT keys: everything else (`title`, `fields`, `template`, …) — rendered by
 * PanelSet, never interpreted by PanelFlow. Kept loose for now via an index
 * signature; the content contract firms up when rendering lands.
 */
export interface StepDef {
	id: string;
	/** Outgoing edge. Absent = terminal (end of flow). */
	next?: NextSpec;
	title?: string;
	fields?: FieldDef[];
	template?: string;
	[contentKey: string]: unknown;
}

/** A whole flow: where to start, and the steps by id (inline / static-file case). */
export interface FlowDef {
	entry: string;
	steps: Record<string, StepDef>;
}
