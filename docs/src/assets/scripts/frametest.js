// Frame-test wiring for frametest.pug. Two separate concerns live here:
//   1. meter   - measures dropped frames during a toggle. Knows nothing about
//                animations: you hand it an output node and a window length.
//   2. demos   - wires each cell's toggle and, for the JS/Grid variants, drives
//                the animation. This is where the animation timing (duration and
//                easing) lives, deliberately kept out of the meter.
// Self-contained: no imports, no globals.
(function () {

	// ========================================================================
	// Meter - pure dropped-frame measurement, independent of any animation.
	// ========================================================================

	// A frame counts as "late" once it takes longer than this many native frame
	// budgets. Lower = stricter = higher percentages. 1.5 only catches a full
	// missed frame; 1.25 also counts frames that ran noticeably long.
	const lateFactor = 1.5;

	// Calibrate the display's native frame time once, from idle rAF. The
	// meter compares each animation frame against THIS baseline, not the
	// animation's own frames. Using the run's own median would hide a run
	// that is slow on EVERY frame (uniform 30fps reads as "0 dropped"),
	// which is exactly the iOS case. Note: this measures main-thread frame
	// cadence, so it catches jank that stalls the main thread.
	let nativeFrame = 1000 / 60; // fallback until calibrated
	(function calibrate() {
		const deltas = [];
		let last = performance.now();
		let n = 0;
		function tick(now) {
			deltas.push(now - last); last = now;
			if (++n < 50) { requestAnimationFrame(tick); }
			else { deltas.sort((a, b) => a - b); nativeFrame = deltas[Math.floor(deltas.length * 0.2)]; }
		}
		requestAnimationFrame(tick);
	})();

	// Sample frame timing for windowMs, then hand the result (dropped %, fps) to
	// onResult. The meter does no display or bookkeeping of its own.
	function measure(windowMs, onResult) {
		const deltas = [];
		let last = performance.now();
		let raf;
		function tick(now) { deltas.push(now - last); last = now; raf = requestAnimationFrame(tick); }
		raf = requestAnimationFrame(tick);
		setTimeout(function () {
			cancelAnimationFrame(raf);
			if (deltas.length < 2) return; // not enough data, leave the readout as-is
			const threshold = nativeFrame * lateFactor;
			const dropped = deltas.filter((d) => d > threshold).length;
			const pct = Math.round((dropped / deltas.length) * 100);
			// Effective frame rate over the window: frames / seconds elapsed. In
			// Low Power Mode this reads ~30fps while dropped stays ~0, which is
			// what makes an LPM run look choppy without any frames being late.
			const elapsed = deltas.reduce((a, b) => a + b, 0);
			const fps = Math.round((deltas.length / elapsed) * 1000);
			onResult(pct, fps);
		}, windowMs);
	}

	// ========================================================================
	// Demo animation timing - shared so every variant feels the same. The lib
	// and Grid rows animate via CSS (var(--ps-open-timing) = ease-in-out); the
	// JS-per-frame row has to match that curve by hand, so easeInOut below is
	// the exact cubic-bezier CSS ease-in-out uses. None of this belongs to the
	// meter; it only shapes how the JS demo moves.
	// ========================================================================

	const animationMs = 300;               // matches the page's --ps-open-speed
	const sampleWindowMs = animationMs + 50; // a touch longer, so the tail is caught

	// Solve a CSS cubic-bezier(x1, y1, x2, y2) into an easing function of time.
	function cubicBezier(x1, y1, x2, y2) {
		const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
		const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
		const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
		const sampleY = (t) => ((ay * t + by) * t + cy) * t;
		const solveT = (x) => {
			let t = x;
			for (let i = 0; i < 5; i++) {
				const dx = sampleX(t) - x;
				const slope = (3 * ax * t + 2 * bx) * t + cx;
				if (Math.abs(dx) < 1e-4 || slope === 0) break;
				t -= dx / slope;
			}
			return t;
		};
		return (x) => sampleY(solveT(x));
	}
	const easeInOut = cubicBezier(0.42, 0, 0.58, 1); // === CSS ease-in-out

	// ========================================================================
	// Readout - peak-hold + severity color, layered on top of the meter. Each
	// button click belongs to a "series"; the readout holds the WORST run of the
	// series and keeps showing it. A gap of resetMs with no clicks starts a fresh
	// series on the next click. This is a display concern, not the meter.
	// ========================================================================

	const resetMs = 2000; // idle gap (no clicks) that starts a new series
	const zeroBelow = 5;  // <= this many % reads as 0% (noise floor)
	const warnAt = 9;    // >= this %: orange
	const badAt = 17;     // >  this %: red

	function makeReporter(out) {
		let maxPct = -1;
		let lastClick = 0;

		// Call at each click: a long enough idle gap resets the series peak.
		function onClick() {
			const now = performance.now();
			if (now - lastClick > resetMs) maxPct = -1;
			lastClick = now;
		}

		// Call when a measurement lands: hold the worst run of the series.
		function onResult(pct, fps) {
			if (pct <= maxPct) return; // keep showing the current peak
			maxPct = pct;
			const shown = pct <= zeroBelow ? 0 : pct;
			out.textContent = shown + '% dropped · ' + fps + ' fps';
			out.classList.toggle('is-bad', pct > badAt);
			out.classList.toggle('is-warn', pct >= warnAt && pct <= badAt);
		}

		return { onClick, onResult };
	}

	// ========================================================================
	// Wiring
	// ========================================================================

	document.addEventListener('DOMContentLoaded', function () {
		document.querySelectorAll('.techcell').forEach(function (demo) {
			const region = demo.querySelector('.techregion');
			const btn = demo.querySelector('.techtoggle');
			const out = demo.querySelector('.techout');
			const tech = region.getAttribute('data-tech');

			const reporter = makeReporter(out);
			// One click = mark the series, then measure and feed the peak-hold.
			function report() {
				reporter.onClick();
				measure(sampleWindowMs, reporter.onResult);
			}

			if (tech === 'lib') {
				// Panel wired the [aria-controls] button already; just measure.
				btn.addEventListener('click', report);
			} else if (tech === 'js') {
				let open = false;
				btn.addEventListener('click', function () {
					const inner = region.firstElementChild;
					const start = region.offsetHeight;
					const target = open ? 0 : inner.offsetHeight;
					open = !open;
					btn.setAttribute('aria-expanded', String(open));
					region.classList.toggle('open', open); // drives the opacity fade
					const t0 = performance.now();
					function step(now) {
						const p = Math.min((now - t0) / animationMs, 1);
						const eased = easeInOut(p); // match the CSS ease-in-out of the other variants
						region.style.height = (start + (target - start) * eased) + 'px';
						if (p < 1) requestAnimationFrame(step);
					}
					requestAnimationFrame(step);
					report();
				});
			} else if (tech === 'grid') {
				btn.addEventListener('click', function () {
					const o = region.classList.toggle('open');
					btn.setAttribute('aria-expanded', String(o));
					report();
				});
			} else if (tech === 'panelset') {
				// Triggers live outside the panelset container; find them in the cell.
				demo.querySelectorAll('.pstrigger').forEach(function (t) {
					t.addEventListener('click', function (e) {
						const id = t.getAttribute('aria-controls');
						if (region.panelSet) region.panelSet.show(id, { event: e });
						report();
					});
				});
			}
		});
	});
})();
