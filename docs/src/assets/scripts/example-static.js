// Static demo. The box is resized by hand, a ResizeObserver watches it, and the
// panel is told what it is with setStatic(). A container query cannot do this:
// `static` takes a media query, and media queries only ever see the viewport.

const THRESHOLD = 480;

const box = document.getElementById('static-box');
const panelEl = document.getElementById('static-panel');
const out = document.getElementById('static-markup');
const readout = document.getElementById('static-readout');

// Held, not looked up each time. A static panel takes aria-controls off its trigger, so
// [aria-controls] would find nothing exactly when the demo has the most to show.
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

// Previous attributes, so a change can be marked rather than left for the reader to spot.
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

	// The button is still in the DOM while static, just hidden by the stylesheet. Fade the
	// line the way a browser's inspector fades a node it is not painting, or the markup
	// looks like it contradicts the demo, where the button has gone.
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

	// Attributes that went away are worth naming: they are gone from the markup,
	// so there is nothing left to highlight.
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

function start() {
	const panel = panelEl.panel;
	if (!panel) return requestAnimationFrame(start); // Panel.init() has not run yet

	// Snapshot only at rest. Mid-transition the library writes an inline height and
	// hangs is-opening on the element, which is churn, not the point of the demo.
	for (const ev of ['panel:staticchange', 'panel:opened', 'panel:closed']) {
		panelEl.addEventListener(ev, render);
	}

	render(); // the state it starts in, with nothing marked yet

	// The observer does NOT render. setStatic() dispatches panel:staticchange
	// synchronously, so the listener above has already drawn the marks by the time
	// this returns. Rendering again here would compare the new state against itself,
	// find nothing changed, and wipe those marks in the same tick.
	//
	// And it does its work in the NEXT frame, not during delivery. setStatic() changes
	// the DOM, and changing layout inside a ResizeObserver callback makes the browser
	// queue another round it cannot deliver, which is the "ResizeObserver loop completed
	// with undelivered notifications" warning. Handing it to rAF keeps the callback itself
	// free of layout writes.
	let frame = 0;
	new ResizeObserver(([entry]) => {
		const width = entry.contentRect.width;
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(() => {
			panel.setStatic(width >= THRESHOLD); // ignored when it is already in that state
			label(width, panel.isStatic);
		});
	}).observe(box);
}

start();
