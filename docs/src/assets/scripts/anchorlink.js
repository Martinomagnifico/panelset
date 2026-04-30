
document.querySelectorAll('.heading-anchor a').forEach(link => {
	link.addEventListener('click', async (e) => {
		e.preventDefault();
		const url = window.location.origin + window.location.pathname + link.getAttribute('href');

		clearTimeout(link._resetTimer);

		try {
			await navigator.clipboard.writeText(url);
			link.dataset.tooltip = 'Link copied!';
			link.classList.add('is-copied');
		} catch (err) {
			console.error('Failed to copy link: ', err);
		}

		link._resetTimer = setTimeout(() => {
			link.dataset.tooltip = 'Copy link';
			link.classList.remove('is-copied');
		}, 1200);
	});
});
