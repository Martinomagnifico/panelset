import type { Answers, StepDef } from './types';
import type { Loader } from './loader';
import { FlowEngine } from './engine';

/**
 * The minimal PanelSet surface the controller drives — its PUBLIC API only. Declared
 * structurally (not imported) so the orchestrator stays a pure consumer and can be
 * tested against a fake; a real PanelSet instance satisfies this shape. This is what
 * preserves the one-way chain — PanelSet never imports PanelFlow.
 */
export interface PanelSetLike {
	show(id: string, options?: { event?: Event }): unknown;
	getActive(): string | null;
	addPanel(panel: HTMLElement, position?: { after?: string; before?: string; index?: number }): HTMLElement;
	removePanel(id: string): void;
	/** The set's element — the controller listens for ps:activationcomplete on it to
	 *  prune the window only AFTER a transition finishes (pruning mid-transition would
	 *  refresh() and clobber the animation). */
	element: HTMLElement;
}

export interface FlowControllerOptions {
	/** Build a [role="tabpanel"] element for a step. Content rendering is the app's. */
	render: (step: StepDef) => HTMLElement;
	answers?: Answers;
	/** Prefix for the DOM panel id, so multiple flows on one page don't collide
	 *  (the engine still works in logical step ids). Default '' (id = step id). */
	idPrefix?: string;
}

/**
 * Bridges the pure FlowEngine to a PanelSet (the temporary sibling). It maintains a
 * sliding window of materialised panels — `[previous, current]` — and activates the
 * resolved step. Removing out-of-window panels goes through PanelSet.removePanel,
 * whose refresh() re-syncs the Prev/Next end-state for the new ends.
 */
export class FlowController {
	readonly engine: FlowEngine;
	private readonly set: PanelSetLike;
	private readonly render: (step: StepDef) => HTMLElement;
	private readonly idPrefix: string;
	private readonly live = new Map<string, HTMLElement>(); // logical step id → panel

	constructor(set: PanelSetLike, load: Loader, opts: FlowControllerOptions) {
		this.set = set;
		this.render = opts.render;
		this.idPrefix = opts.idPrefix ?? '';
		this.engine = new FlowEngine(load, opts.answers ?? {});
		// Prune only once a transition has fully completed — pruning synchronously
		// after show() would refresh() mid-animation and clobber it.
		this.set.element.addEventListener('ps:activationcomplete', () => this._prune());
	}

	/** Logical step id → DOM panel id (namespaced so flows can coexist on a page). */
	private _domId(stepId: string): string { return this.idPrefix + stepId; }

	/** Load the entry step, materialise it, activate it. */
	async start(entryId: string): Promise<void> {
		const step = await this.engine.start(entryId);
		this._materialise(step);
		this.set.show(this._domId(step.id));
	}

	/** Resolve + load the next step, materialise it, activate it. (Pruning happens on
	 *  ps:activationcomplete, after the transition.) */
	async advance(): Promise<void> {
		const step = await this.engine.advance();
		this._materialise(step);
		this.set.show(this._domId(step.id));
	}

	/** Pop history, (re)materialise that step, activate it. */
	async back(): Promise<void> {
		const step = await this.engine.back();
		this._materialise(step); // idempotent; re-adds if it was pruned
		this.set.show(this._domId(step.id));
	}

	setAnswers(patch: Answers): void { this.engine.setAnswers(patch); }

	private _materialise(step: StepDef): void {
		if (this.live.has(step.id)) return;
		const panel = this.render(step);
		panel.id = this._domId(step.id);
		this.set.addPanel(panel);
		this.live.set(step.id, panel);
	}

	// Keep only the sliding window [previous, current]; remove the rest from the set.
	// removePanel refreshes, which re-syncs the verb buttons for the new ends.
	private _prune(): void {
		const keep = new Set(
			[this.engine.previousId, this.engine.current.id].filter((x): x is string => x != null),
		);
		for (const id of [...this.live.keys()]) {
			if (!keep.has(id)) {
				this.set.removePanel(this._domId(id));
				this.live.delete(id);
			}
		}
	}
}
