// Static demo. The box is resized by hand, a ResizeObserver watches it, and the
// panel is told what it is with setStatic(). A container query cannot do this:
// `static` takes a media query, and media queries only ever see the viewport.
//
// The handle is ours, not CSS `resize`, which iOS Safari does not draw at all. Pointer
// events cover mouse, pen and touch in one go, and the arrow keys do it without a pointer.

// All three are the DEMO's width, never the box's: the box also carries its own borders.
const THRESHOLD = 260; // low enough that both states are reachable on a phone
const MIN = 220;       // it never goes narrower than it starts: there is nothing to learn down there
const START = 220;

const box = document.getElementById('static-box');
const handle = document.getElementById('static-handle');
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

// The box is border-box, so its width has to carry its own borders. The handle is not in
// here: it hangs over the border, outside the box, and takes no space from the demo.
const borders = () => box.offsetWidth - box.clientWidth;
const boxWidthFor = (demoWidth) => demoWidth + borders();
const demoWidthOf = (boxWidth) => boxWidth - borders();

// The width you asked for, which is not always the width you can have. A drag writes pixels,
// and pixels do not shrink when the browser does, so a narrow window would send the box out
// through the side of the card. The wish is kept here and re-applied against whatever room
// there is, so the box folds down when the window narrows and returns to the width you dragged
// to when there is room for it again.
let wanted = null;

const container = box.closest('.static-demo');

// The wrapper is only as wide as the box, so the room to grow comes from the demo around it,
// less the half of the grip that hangs past the border.
const maxWidth = () => container.getBoundingClientRect().width - 16;

// The handle. Pointer events, so one path covers mouse, pen and touch, and iOS is not
// left out the way it is by CSS `resize`. The pointer is captured, so a fast drag that
// leaves the handle keeps resizing instead of stopping dead.
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

	// Without this a pointer is the only way to cross the threshold, which would be a poor
	// showing for a demo whose whole subject is the keyboard and the accessibility tree.
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
	if (!panel) return requestAnimationFrame(start); // Panel.init() has not run yet

	// Snapshot only at rest. Mid-transition the library writes an inline height and
	// hangs is-opening on the element, which is churn, not the point of the demo.
	for (const ev of ['panel:staticchange', 'panel:opened', 'panel:closed']) {
		panelEl.addEventListener(ev, render);
	}

	draggable();
	setWidth(boxWidthFor(START));
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
	// The room around the box can change without anyone touching the handle (the window narrows,
	// the sidebar opens). Re-apply the width that was asked for, clamped to what is now available.
	let containerFrame = 0;
	new ResizeObserver(() => {
		cancelAnimationFrame(containerFrame);
		containerFrame = requestAnimationFrame(() => {
			if (wanted !== null) setWidth(wanted, false); // re-apply, do not overwrite the wish
		});
	}).observe(container);

	let frame = 0;
	new ResizeObserver(([entry]) => {
		const width = entry.contentRect.width; // the handle is outside the box, so this is the demo
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(() => {
			panel.setStatic(width >= THRESHOLD); // ignored when it is already in that state
			label(width, panel.isStatic);
		});
	}).observe(box);
}

start();
