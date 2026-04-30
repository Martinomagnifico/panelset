// Example script to demonstrate PanelSet usage

document.addEventListener('click', event => {
	const button = event.target.closest('button[aria-controls]');
	if (!button) return;

	const panelId = button.getAttribute('aria-controls');
	const panel = document.getElementById(panelId);
	const container = panel?.closest('[data-panelset]');
	
	container?.panelSet?.show(panelId, { event });
});

// Log all events

// document.addEventListener('ps:ready', (e) => {
// 	console.log('This panelset is ready:', e.detail.container.id);
// });

document.addEventListener('ps:beforeopen', (e) => {
	console.log('Before doing any transitions:', e.detail.panelId);
});

document.addEventListener('ps:activationstart', (e) => {
	console.log('Started a transition:', e.detail.panelId);
});

document.addEventListener('ps:activationcomplete', (e) => {
	console.log('Completed a transition:', e.detail.panelId);
});

document.addEventListener('ps:activationaborted', (e) => {
	console.log('Aborted the loading of a panel:', e.detail.panelId);
});
