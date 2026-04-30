document.addEventListener('click', event => {
	const button = event.target.closest('button[aria-controls]');
	if (!button) return;
	const panelId = button.getAttribute('aria-controls');
	const container = document.getElementById(panelId)?.closest('[data-panelset]');
	container?.panelSet?.show(panelId, {event});
});

document.addEventListener('click', event => {
	const actions = ['close', 'open', 'toggle'];
	
	for (const action of actions) {
		const btn = event.target.closest(`[data-panelset-${action}]`);
		if (btn) {
			const selector = btn.getAttribute(`data-panelset-${action}`);
			const container = document.querySelector(selector);
			
			if (container?.panelSet) {
				const withTransition = !btn.hasAttribute('data-no-transition');
				container.panelSet[action]({ 
					event: event, 
					transition: withTransition 
				});
			}
			return;
		}
	}
});