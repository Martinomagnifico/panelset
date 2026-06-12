// Proto-PanelFlow: the flow logic that sits on top of PanelControl + PanelSet.
// PanelControl already wires the tab clicks, keyboard nav, roving and the
// aria-disabled locking. What's left here (validation, the lock policy, the
// forward gate, and the Prev/Next stepping) is the slice a future PanelFlow
// package will own.
(() => {
	const strip = document.querySelector('#pcwiz-tabs');
	const setEl = document.querySelector('#pcwiz');
	if (!strip || !setEl) return;

	const tabs    = [...strip.querySelectorAll('[role="tab"]')];
	const nextBtn = document.querySelector('[data-pcwiz-next]');
	const prevBtn = document.querySelector('[data-pcwiz-prev]');
	const panelOf = tab => document.getElementById(tab.getAttribute('aria-controls'));
	const valid   = panel => !panel.querySelector('[required]:invalid');

	// Buttons step through the set. PanelControl already wires the tab clicks.
	nextBtn.addEventListener('click', e => setEl.panelSet?.next({ event: e }));
	prevBtn.addEventListener('click', e => setEl.panelSet?.prev({ event: e }));

	// Hard gate: one listener covers every path into show() (tabs, buttons, keys).
	setEl.addEventListener('ps:beforeactivate', e => {
		const { outgoingPanel, targetPanel } = e.detail;
		const forward = outgoingPanel &&
			(outgoingPanel.compareDocumentPosition(targetPanel) & Node.DOCUMENT_POSITION_FOLLOWING);
		if (forward && !valid(outgoingPanel)) {
			e.preventDefault();
			outgoingPanel.querySelector('[required]:invalid')?.focus();
		}
	});

	// Soft state: lock every step beyond the first incomplete one, through PanelControl.
	const refresh = () => {
		const pc = strip.panelControl;
		if (!pc) return;
		const firstInvalid = tabs.findIndex(t => !valid(panelOf(t)));
		tabs.forEach((t, i) => pc.setTabState(
			t.getAttribute('aria-controls'),
			firstInvalid !== -1 && i > firstInvalid ? 'disabled' : 'enabled'
		));
	};
	setEl.addEventListener('change', refresh);
	setEl.addEventListener('ps:activationcomplete', refresh);

	// Prev/Next at the ends. Move focus off a button before disabling it, or the
	// browser drops focus to <body> and the next Tab leaves the wizard.
	setEl.addEventListener('ps:activationstart', e => {
		const { atStart, atEnd } = e.detail;
		if (atEnd   && document.activeElement === nextBtn) prevBtn.focus();
		if (atStart && document.activeElement === prevBtn) nextBtn.focus();
		prevBtn.disabled = atStart;
		nextBtn.disabled = atEnd;
	});

	// Initial state once the instances are live.
	if (setEl.panelSet) refresh();
	else setEl.addEventListener('ps:ready', refresh, { once: true });
})();
