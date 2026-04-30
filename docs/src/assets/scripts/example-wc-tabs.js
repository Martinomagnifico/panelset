document.addEventListener('click', event => {
	const button = event.target.closest('button[aria-controls]');
	if (!button) return;

	const tablist = button.closest('[role="tablist"]');
	tablist?.querySelectorAll('[role="tab"]').forEach(t => {
		t.setAttribute('aria-selected', 'false');
	});
	button.setAttribute('aria-selected', 'true');

	const panelId = button.getAttribute('aria-controls');
	const panel = document.getElementById(panelId);
	const container = panel?.closest('ps-panelset');

	container?.panelSet?.show(panelId, { event });
});
