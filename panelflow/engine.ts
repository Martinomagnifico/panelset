import type { Answers, StepDef } from './types';
import type { Loader } from './loader';
import { resolve } from './resolver';

/**
 * The pure flow state machine: current step, collected answers, and a back-history
 * stack. No DOM, no PanelSet — it resolves the LOGICAL path and loads step data
 * through the injected Loader. The orchestrator (phase 5) maps its window onto
 * PanelSet panels.
 *
 * `prev` comes from the runtime history stack (pushed on advance, popped on back),
 * not from the flow JSON — back-edges aren't well defined under branching. The
 * extremes are intrinsic: entry = no previous, terminal = no next.
 */
export class FlowEngine {
	current!: StepDef;
	answers: Answers;
	private readonly load: Loader;
	private history: string[] = []; // ids visited before `current` (the back-stack)

	constructor(load: Loader, answers: Answers = {}) {
		this.load = load;
		this.answers = answers;
	}

	/** Load the entry step and reset history. */
	async start(entryId: string): Promise<StepDef> {
		this.history = [];
		this.current = await this.load(entryId);
		return this.current;
	}

	/** Logical next id under the current answers, or null (terminal / unresolved). */
	get nextId(): string | null { return resolve(this.current, this.answers); }

	/** Id we'd return to on back(), or null at the entry. */
	get previousId(): string | null {
		return this.history.length ? this.history[this.history.length - 1] : null;
	}

	get canAdvance(): boolean { return this.nextId !== null; }
	get canGoBack(): boolean { return this.history.length > 0; }

	/** The sliding window: what's behind, what's shown, what's next (once resolved). */
	get window(): { previousId: string | null; currentId: string; nextId: string | null } {
		return { previousId: this.previousId, currentId: this.current.id, nextId: this.nextId };
	}

	/** Load the next step WITHOUT advancing — materialise the next slot. */
	async peekNext(): Promise<StepDef | null> {
		const id = this.nextId;
		return id === null ? null : this.load(id);
	}

	/** Resolve + load the next step, make it current, push the old current to history. */
	async advance(): Promise<StepDef> {
		const nextId = this.nextId;
		if (nextId === null) throw new Error('PanelFlow: cannot advance (terminal or unresolved)');
		this.history.push(this.current.id);
		this.current = await this.load(nextId);
		return this.current;
	}

	/** Pop the history stack and make that step current. */
	async back(): Promise<StepDef> {
		const prevId = this.history.pop();
		if (prevId === undefined) throw new Error('PanelFlow: cannot go back (at entry)');
		this.current = await this.load(prevId);
		return this.current;
	}

	/** Merge in answers, so nextId / canAdvance reflect them. */
	setAnswers(patch: Answers): void { Object.assign(this.answers, patch); }
}
