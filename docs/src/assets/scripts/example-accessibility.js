const wizardEl    = document.getElementById('a11y-first-demo');
const backBtn     = document.getElementById('a11y-wizard-back');
const nextBtn     = document.getElementById('a11y-wizard-next');
const wizardSteps = ['a11y-f-panel-1', 'a11y-f-panel-2', 'a11y-f-panel-3'];

function updateWizardControls(panelId) {
	const idx    = wizardSteps.indexOf(panelId);
	const isLast = idx === wizardSteps.length - 1;
	backBtn.disabled  = idx === 0;
	nextBtn.innerHTML = isLast ? 'Submit' : 'Next <svg class="chevron" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.44" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"></polyline></svg>';
}

backBtn.addEventListener('click', () => {
	const idx = wizardSteps.indexOf(wizardEl.panelSet.getActive());
	if (idx > 0) wizardEl.panelSet.show(wizardSteps[idx - 1], { event });
});

nextBtn.addEventListener('click', (event) => {
	const idx = wizardSteps.indexOf(wizardEl.panelSet.getActive());
	if (idx < wizardSteps.length - 1) {
		wizardEl.panelSet.show(wizardSteps[idx + 1], { event });
	} else {
		alert('Submitted!');
	}
});

wizardEl.addEventListener('ps:activationcomplete', (e) => {
	updateWizardControls(e.detail.panelId);
});

if (wizardEl.panelSet) {
	updateWizardControls(wizardEl.panelSet.getActive());
} else {
	wizardEl.addEventListener('ps:ready', (e) => updateWizardControls(e.detail.instance.getActive()), { once: true });
}
