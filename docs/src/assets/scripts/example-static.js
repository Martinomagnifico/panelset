// Static demo.

const THRESHOLD = 260; 
const MIN = 220; 
const START = 220;

const box = document.getElementById('static-box');
const handle = document.getElementById('static-handle');
const panelEl = document.getElementById('static-panel');
const out = document.getElementById('static-markup');
const readout = document.getElementById('static-readout');

const trigger = box.querySelector('button');

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// name="value", or a bare name for the boolean ones (data-panel, inert). Empty
// class and style attributes are dropped: they are leftovers, not state.
const attrsOf = (el) => {
	const map = new Map();
	for (const { name, value } of el.attributes) {
		if ((name === 'class' || name === 'style') && value.trim() === '') continue;
		map.set(name, value);
	}
	return map;
};

let previous = null;

const openTag = (el, before) => {
	const attrs = attrsOf(el);
	const parts = [];
	for (const [name, value] of attrs) {
		const text = value === '' ? name : `${name}="${value}"`;
		const changed = before && before.get(el.id || el.tagName) &&
			before.get(el.id || el.tagName).get(name) !== value;
		parts.push(changed ? `<mark>${esc(text)}</mark>` : esc(text));
	}
	return `&lt;${el.tagName.toLowerCase()}${parts.length ? ' ' + parts.join(' ') : ''}&gt;`;
};

const key = (el) => el.id || el.tagName;

function render() {
	const wrapper = panelEl.querySelector(':scope > .panel-wrapper');
	const para = wrapper.querySelector('p');

	const now = new Map([[key(trigger), attrsOf(trigger)], [key(panelEl), attrsOf(panelEl)]]);

	const hidden = trigger.hasAttribute('data-ps-static');
	const buttonLine = openTag(trigger, previous) + esc(trigger.textContent.trim()) + '&lt;/button&gt;';

	const lines = [
		hidden ? `<span class="not-rendered">${buttonLine}</span>` : buttonLine,
		'',
		openTag(panelEl, previous),
		'\t&lt;div class="panel-wrapper"&gt;',
		'\t\t&lt;p&gt;' + esc(para.textContent.trim()) + '&lt;/p&gt;',
		'\t&lt;/div&gt;',
		'&lt;/div&gt;',
	];

	const removed = [];
	if (previous) {
		for (const [k, before] of previous) {
			const after = now.get(k);
			for (const name of before.keys()) if (!after.has(name)) removed.push(name);
		}
	}

	out.innerHTML = lines.join('\n');
	out.dataset.removed = removed.length ? `removed: ${removed.join(', ')}` : '';
	previous = now;
}

function label(width, isStatic) {
	readout.textContent = `${Math.round(width)}px, ${isStatic ? 'static: plain content, no trigger' : 'collapsible: a disclosure with a trigger'}`;
}

const borders = () => box.offsetWidth - box.clientWidth;
const boxWidthFor = (demoWidth) => demoWidth + borders();
const demoWidthOf = (boxWidth) => boxWidth - borders();

let wanted = null;

const container = box.closest('.static-demo');

const maxWidth = () => container.getBoundingClientRect().width - 16;

function setWidth(px, remember = true) {
	if (remember) wanted = px;
	const width = Math.max(boxWidthFor(MIN), Math.min(px, maxWidth()));
	box.style.width = `${width}px`;
	handle.setAttribute('aria-valuenow', String(Math.round(demoWidthOf(width))));
	return width;
}

function draggable() {
	let startX = 0;
	let startWidth = 0;

	handle.addEventListener('pointerdown', (e) => {
		startX = e.clientX;
		startWidth = box.getBoundingClientRect().width;
		handle.setPointerCapture(e.pointerId);
		handle.dataset.dragging = '';
		e.preventDefault(); // or a touch-drag scrolls the page instead
	});

	handle.addEventListener('pointermove', (e) => {
		if (!handle.hasPointerCapture(e.pointerId)) return;
		setWidth(startWidth + (e.clientX - startX));
	});

	const stop = (e) => {
		if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
		delete handle.dataset.dragging;
	};
	handle.addEventListener('pointerup', stop);
	handle.addEventListener('pointercancel', stop);

	handle.addEventListener('keydown', (e) => {
		const width = box.getBoundingClientRect().width;
		const step = e.shiftKey ? 50 : 10;
		const to = {
			ArrowRight: width + step,
			ArrowLeft: width - step,
			Home: boxWidthFor(MIN),
			End: Infinity,
		}[e.key];
		if (to === undefined) return;
		e.preventDefault();
		setWidth(to);
	});

	handle.setAttribute('aria-valuemin', String(MIN));
}

function start() {
	const panel = panelEl.panel;
	if (!panel) return requestAnimationFrame(start);

	for (const ev of ['panel:staticchange', 'panel:opened', 'panel:closed']) {
		panelEl.addEventListener(ev, render);
	}

	draggable();
	setWidth(boxWidthFor(START));
	render(); 

	let containerFrame = 0;
	new ResizeObserver(() => {
		cancelAnimationFrame(containerFrame);
		containerFrame = requestAnimationFrame(() => {
			if (wanted !== null) setWidth(wanted, false);
		});
	}).observe(container);

	let frame = 0;
	new ResizeObserver(([entry]) => {
		const width = entry.contentRect.width;
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(() => {
			panel.setStatic(width >= THRESHOLD);
			label(width, panel.isStatic);
		});
	}).observe(box);
}

start();
