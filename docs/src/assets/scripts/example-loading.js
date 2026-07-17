function slowLoad(el, html, signal, ms = 1600) {
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => {
			el.innerHTML = html;
			resolve();
		}, ms);
		signal.addEventListener('abort', () => {
			clearTimeout(t);
			reject(new DOMException('Aborted', 'AbortError'));
		});
	});
}

const fromTemplate = (id) => document.getElementById(id)?.innerHTML ?? '';

document.getElementById('li-panel')?.panel?.onBeforeOpen(
	(el, signal) => slowLoad(el.querySelector('.panel-wrapper'), fromTemplate('li-panel-content'), signal),
	{ once: false }
);

document.addEventListener('click', (e) => {
	const button = e.target.closest('.uses-trigger-spinner button[aria-controls]');
	if (!button) return;
	const panelId = button.getAttribute('aria-controls');
	const container = document.getElementById(panelId)?.closest('[data-panelset]');
	container?.panelSet?.show(panelId, { event: e });
});

const liTabs = document.getElementById('li-tabs');

function setupLiTabs(instance) {
	instance.onBeforeOpen((targetPanel, signal) => {
		if (targetPanel.id === 'li-tab-2') {
			return slowLoad(targetPanel, fromTemplate('li-tab-content'), signal);
		}
	}, { once: false });
}

if (liTabs?.panelSet) {
	setupLiTabs(liTabs.panelSet);
} else {
	liTabs?.addEventListener('ps:ready', (e) => setupLiTabs(e.detail.instance), { once: true });
}
