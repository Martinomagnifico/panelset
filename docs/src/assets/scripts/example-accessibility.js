// Wizard controls for the autoFocus: 'first' demo.
// next()/prev() handle the stepping (and clamp at the ends), and the
// ps:activationstart event hands us atStart/atEnd, so there's no step
// array or index math to keep in sync.

const wizardEl  = document.getElementById('a11y-first-demo');
const backBtn   = document.getElementById('a11y-wizard-back');
const nextBtn   = document.getElementById('a11y-wizard-next');
const nextLabel = nextBtn.innerHTML; // "Next" + chevron
let onLastStep  = false;

// Passing { event } means autoFocus only moves focus on keyboard activation.
backBtn.addEventListener('click', event => wizardEl.panelSet?.prev({ event }));
nextBtn.addEventListener('click', event => {
	if (onLastStep) return alert('Submitted!');
	wizardEl.panelSet?.next({ event });
});

wizardEl.addEventListener('ps:activationstart', ({ detail }) => {
	onLastStep        = detail.atEnd;
	backBtn.disabled  = detail.atStart;
	nextBtn.innerHTML = detail.atEnd ? 'Submit' : nextLabel;
});
