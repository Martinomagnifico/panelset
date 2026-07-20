// Demos for the Loading indicators page. Three pairs (Panel + PanelSet), one per section:
//   1  the default spinner
//   2  the same spinner, retuned with CSS variables
//   3  no library spinner at all, shown on the trigger instead
// They all load the same content from a <template> in the page, rendered by the site's own
// example mixins. A timer stands in for a slow network, so the page needs nothing external.

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

const content = () => document.getElementById('li-content')?.innerHTML ?? '';

[1, 2, 3].forEach((n) => {
	// Panel: the library binds its own trigger, so only the content is needed here.
	document.getElementById(`li${n}-panel`)?.panel?.onBeforeOpen(
		(el, signal) => slowLoad(el.querySelector('.panel-wrapper'), content(), signal),
		{ once: false }
	);

	// PanelSet: only the second tab loads, the first is already filled.
	const tabs = document.getElementById(`li${n}-tabs`);
	const setup = (instance) => instance.onBeforeOpen((targetPanel, signal) => {
		if (targetPanel.id === `li${n}-tab-2`) {
			return slowLoad(targetPanel, content(), signal);
		}
	}, { once: false });

	if (tabs?.panelSet) setup(tabs.panelSet);
	else tabs?.addEventListener('ps:ready', (e) => setup(e.detail.instance), { once: true });
});

// A tab click has to be handed to show(): a PanelSet does not bind its own triggers, that is
// PanelControl's job. The Panel buttons are not in a .tabs, so they are left to the library.
document.addEventListener('click', (e) => {
	const button = e.target.closest('.tabs button[aria-controls]');
	if (!button) return;
	const panelId = button.getAttribute('aria-controls');
	const container = document.getElementById(panelId)?.closest('[data-panelset]');
	container?.panelSet?.show(panelId, { event: e });
});
