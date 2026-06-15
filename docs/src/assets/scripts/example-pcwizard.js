// The flow layer: logic that sits on top of PanelControl + PanelSet.
// PanelControl wires the tab clicks, keyboard nav, roving and the aria-disabled
// locking (with each tab's data-pc-disabled-hint); PanelSet wires the
// data-ps-prev / data-ps-next buttons and disables Previous at the first step
// (with its declarative data-ps-disabled-hint). What's left here is flow: the
// forward gate, the lock policy, disabling Next while a step is incomplete — and
// Next's *validation* hint, because that reason is flow's to explain.
(() => {
	const strip = document.querySelector('#pcwiz-tabs');
	const setEl = document.querySelector('#pcwiz');
	if (!strip || !setEl) return;

	const tabs    = [...strip.querySelectorAll('[role="tab"]')];
	const nextBtn = document.querySelector('[data-ps-next="#pcwiz"]');
	const panelOf = tab => document.getElementById(tab.getAttribute('aria-controls'));
	const valid   = panel => !panel.querySelector('[required]:invalid');

	// Hard gate: one listener covers every path into show() (tabs, the prev/next
	// buttons, keyboard). Stepping back is always allowed.
	setEl.addEventListener('ps:beforeactivate', e => {
		const { outgoingPanel, targetPanel } = e.detail;
		const forward = outgoingPanel &&
			(outgoingPanel.compareDocumentPosition(targetPanel) & Node.DOCUMENT_POSITION_FOLLOWING);
		if (forward && !valid(outgoingPanel)) {
			e.preventDefault();
			outgoingPanel.querySelector('[required]:invalid')?.focus();
		}
	});

	// Soft state: lock the steps beyond the first incomplete one (PanelControl),
	// and disable Next until the current step is valid. PanelSet already disables
	// Next at the last step; we add the validation rule on top. Because the button
	// stays focusable (aria mode), set its hint to match WHY it is disabled —
	// "last step" at the end, "complete this step" when the step is incomplete.
	const refresh = () => {
		const pc = strip.panelControl;
		const ps = setEl.panelSet;
		if (!pc || !ps) return;

		const firstInvalid = tabs.findIndex(t => !valid(panelOf(t)));
		tabs.forEach((t, i) => pc.setTabState(
			t.getAttribute('aria-controls'),
			firstInvalid !== -1 && i > firstInvalid ? 'disabled' : 'enabled'
		));

		const i = tabs.findIndex(t => t.getAttribute('aria-controls') === ps.getActive());
		const atEnd = i === tabs.length - 1;
		const incomplete = i >= 0 && !valid(panelOf(tabs[i]));
		nextBtn?.setAttribute('aria-disabled', String(atEnd || incomplete));
		const hint = atEnd ? 'pcwiz-next-hint' : incomplete ? 'pcwiz-next-incomplete-hint' : '';
		if (hint) nextBtn?.setAttribute('aria-describedby', hint);
		else nextBtn?.removeAttribute('aria-describedby');
	};
	setEl.addEventListener('change', refresh);
	setEl.addEventListener('ps:activationcomplete', refresh);

	// Initial state once the instances are live.
	if (setEl.panelSet) refresh();
	else setEl.addEventListener('ps:ready', refresh, { once: true });
})();
