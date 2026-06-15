// PanelFlow (PREVIEW) — incubating inside the panelset repo, used only by these
// docs. It consumes PanelControl + PanelSet's PUBLIC surface (instance properties,
// events, setTabState, next/prev) and NOTHING in src/js/ depends on it. Strict
// one-way: flow → PanelControl → PanelSet. When it matures it lifts out to its own
// package; until then it lives here so it can co-evolve with the layers below.
//
// data-panelflow goes on a [data-panelcontrol] tablist. v0 owns the "flow" slice
// the PS/PC wizard demos hand-write on every page:
//   • a forward gate (ps:beforeactivate) blocking advance past an invalid step,
//   • step locking (control.setTabState) beyond the first incomplete step,
//   • disabling Next until the current step is valid, announcing the author's
//     reason message (data-pf-disabled-hint) while it is locked.
// On the LAST step the forward control becomes a FINISH action: it stays enabled
// (it is not dimmed for being at the end), is relabelled (data-pf-finish), and its
// click fires a pf:finish event instead of stepping past the end — what finishing
// DOES is the app's. Validation is native [required]:invalid for now. Roadmap:
// a schema/data store, branching, and persistence.
(() => {
	const valid = panel => !panel.querySelector('[required]:invalid');

	class PanelFlow {
		// Wire every [data-panelflow] control. PanelSet + PanelControl must be
		// initialised first (PanelFlow reads their instances).
		static init(selector = '[data-panelflow]') {
			return [...document.querySelectorAll(selector)]
				.filter(el => !el.panelFlow)
				.map(el => new PanelFlow(el));
		}

		constructor(controlEl) {
			if (controlEl.panelFlow) return controlEl.panelFlow;
			controlEl.panelFlow = this;
			this.controlEl = controlEl;
			this.tabs = [...controlEl.querySelectorAll('[role="tab"]')];

			this.setEl = controlEl.panelControl?.panelSetElement ?? null;
			if (!this.setEl) { console.warn('PanelFlow: no PanelSet found for', controlEl); return; }
			this.nextBtn = this.setEl.id
				? document.querySelector(`[data-ps-next="#${this.setEl.id}"]`) : null;
			this.atEnd = false;

			// Forward control as a Finish action on the last step: block the no-op
			// next() and fire pf:finish instead (only when enabled). The app listens.
			if (this.nextBtn) {
				this._nextLabel = this.nextBtn.textContent;
				this._finishLabel = this.nextBtn.getAttribute('data-pf-finish');
				this.nextBtn.addEventListener('click', e => {
					if (!this.atEnd) return; // a normal Next on every other step
					e.stopImmediatePropagation(); // block PanelSet's next()
					if (this.nextBtn.getAttribute('aria-disabled') === 'true') return;
					this.setEl.dispatchEvent(new CustomEvent('pf:finish', { bubbles: true }));
				});
			}

			const refresh = () => this._refresh();
			this.setEl.addEventListener('ps:beforeactivate', e => this._gate(e));
			this.setEl.addEventListener('change', refresh);
			this.setEl.addEventListener('ps:activationcomplete', refresh);
			if (this.setEl.panelSet) refresh();
			else this.setEl.addEventListener('ps:ready', refresh, { once: true });
		}

		_panelOf(tab) { return document.getElementById(tab.getAttribute('aria-controls')); }

		// Hard gate: block a forward move past an invalid step, focus what's missing.
		_gate(e) {
			const { outgoingPanel, targetPanel } = e.detail;
			const forward = outgoingPanel &&
				(outgoingPanel.compareDocumentPosition(targetPanel) & Node.DOCUMENT_POSITION_FOLLOWING);
			if (forward && !valid(outgoingPanel)) {
				e.preventDefault();
				outgoingPanel.querySelector('[required]:invalid')?.focus();
			}
		}

		_refresh() {
			const pc = this.controlEl.panelControl;
			const set = this.setEl.panelSet;
			if (!pc || !set) return;

			// Lock every step beyond the first incomplete one (through PanelControl).
			const firstInvalid = this.tabs.findIndex(t => !valid(this._panelOf(t)));
			this.tabs.forEach((t, i) => pc.setTabState(
				t.getAttribute('aria-controls'),
				firstInvalid !== -1 && i > firstInvalid ? 'disabled' : 'enabled'
			));

			if (!this.nextBtn) return;
			const i = this.tabs.findIndex(t => t.getAttribute('aria-controls') === set.getActive());
			this.atEnd = i === this.tabs.length - 1;
			const incomplete = i >= 0 && !valid(this._panelOf(this.tabs[i]));

			// Disable the forward control only for an INCOMPLETE step — never for being
			// at the end, so the Finish action stays usable. (PanelSet positionally
			// dims it at the end; we run after and override.) Announce the reason while
			// it is blocked, and relabel forward → Finish on the last step.
			this.nextBtn.setAttribute('aria-disabled', String(incomplete));
			const hintId = this.nextBtn.getAttribute('data-pf-disabled-hint');
			if (incomplete && hintId) this.nextBtn.setAttribute('aria-describedby', hintId);
			else this.nextBtn.removeAttribute('aria-describedby');
			if (this._finishLabel) this.nextBtn.textContent = this.atEnd ? this._finishLabel : this._nextLabel;
		}
	}

	if (typeof window !== 'undefined') window.PanelFlow = PanelFlow;
})();
