// Demo-only Web Worker for the Async panels docs page.
// NOT part of the panelset package. It just runs the CPU-heavy fibonacci off
// the main thread so the page (and the loading spinner) stay responsive.
onmessage = (e) => {
	const fib = (n) => (n <= 1 ? n : fib(n - 1) + fib(n - 2));
	postMessage(fib(e.data));
};
