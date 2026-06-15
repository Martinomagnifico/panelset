// PanelFlow (preview) branching demo. The SAME flow, declared three ways via
// data-panelflow-src — inline (#element), a static file, and a mocked endpoint.
// PanelFlow's loaderFromSource() turns each source into a loader; nothing else differs.
import { PanelSet } from 'panelset';
import { FlowController, loaderFromSource } from 'panelflow';
import { setupWorker } from 'msw/browser';
import { http, HttpResponse } from 'msw';

// The mocked "backend": serve one step per id from the same authored flow the inline
// column uses (the #pf-flow <script>). A SIMULATED endpoint — swap for your real URL.
const mswWorker = setupWorker(
	http.get('/pf-api/flow/:id', ({ params }) => {
		const flow = JSON.parse(document.querySelector('#pf-flow').textContent);
		const step = flow.steps[params.id];
		return step ? HttpResponse.json(step) : new HttpResponse(null, { status: 404 });
	}),
);

// Building a panel for a step is the app's job (PanelFlow renders nothing itself).
function renderStep(step) {
	const el = document.createElement('div');
	el.setAttribute('role', 'tabpanel');
	el.setAttribute('aria-label', step.title ?? step.id);
	let html = `<h3>${step.title ?? step.id}</h3>`;
	for (const f of step.fields ?? []) {
		if (f.type === 'radio') {
			html += `<fieldset class="pf-field"><legend>${f.label ?? 'Choose one'}</legend>`;
			for (const o of f.options) {
				html += `<label class="pf-opt"><input type="radio" name="${f.name}" value="${o.value}"> ${o.label}</label>`;
			}
			html += `</fieldset>`;
		} else if (f.type === 'text') {
			html += `<label class="pf-field">${f.label ?? f.name}<br><input type="text" name="${f.name}"></label>`;
		}
	}
	if (!step.next) html += `<p class="pf-end">End of flow.</p>`;
	el.innerHTML = html;
	return el;
}

function mountFlow(form, idPrefix) {
	const setEl = form.querySelector('[data-panelset]');
	new PanelSet(setEl); // empty set is fine — the controller materialises panels
	const set = setEl.panelSet;
	const nextBtn = form.querySelector('[data-pf-continue]');
	const backBtn = form.querySelector('[data-pf-back]');
	const validate = 'pfValidate' in form.dataset;
	const loader = loaderFromSource(setEl.dataset.panelflowSrc);
	const fc = new FlowController(set, loader, { render: renderStep, idPrefix });

	// A step is complete when every field it declares has a non-empty answer (radio
	// picked, text typed). Opt-in via data-pf-validate; off → always considered valid.
	const stepValid = () =>
		!validate ||
		(fc.engine.current?.fields ?? []).every((f) => {
			const v = fc.engine.answers[f.name];
			return v != null && String(v).trim() !== '';
		});
	const canProceed = () => fc.engine.canAdvance && stepValid();

	const sync = () => {
		backBtn.disabled = !fc.engine.canGoBack;
		nextBtn.disabled = !canProceed();
		nextBtn.textContent = fc.engine.current && !fc.engine.current.next ? 'Done' : 'Continue';
	};

	// Commit answers LIVE on `input` (each keystroke / radio pick), not on blur.
	form.addEventListener('input', (e) => {
		if (!e.target.name) return;
		fc.setAnswers({ [e.target.name]: e.target.value });
		requestAnimationFrame(sync);
	});
	// Safari drops the first click on a button when that click blurs a focused text
	// field whose value changed. Keep the field focused (no blur) so the click lands.
	[nextBtn, backBtn].forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));

	nextBtn.addEventListener('click', async () => {
		if (!canProceed()) return;
		await fc.advance();
		sync();
	});
	backBtn.addEventListener('click', async () => {
		if (!fc.engine.canGoBack) return;
		await fc.back();
		sync();
	});

	fc.start('q1').then(sync).catch((err) => console.error('PanelFlow demo:', err));
}

// MSW must be running before the endpoint column's loader fetches; start it, then
// mount every flow (the inline/static columns don't need it — bypassed requests pass
// straight through). The idPrefix keeps the three flows' panel ids distinct.
mswWorker
	.start({ serviceWorker: { url: '/mockServiceWorker.js' }, onUnhandledRequest: 'bypass', quiet: true })
	.finally(() => {
		document.querySelectorAll('form.pf-demo').forEach((form, i) => mountFlow(form, `pf${i}-`));
	});
