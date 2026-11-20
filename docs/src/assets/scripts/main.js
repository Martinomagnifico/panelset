// The menu drawer on narrow screens. In a function, so its names do not become globals that another script overwrites.
document.addEventListener('DOMContentLoaded', () => {
	const nav = document.getElementById('main-nav');
	if (!nav) return;
	const content = document.querySelector('.docs-content');
	const root = document.documentElement;
	let lockedAt = null;

	// The page behind the open drawer stays where it is. The styles are in _nav.scss ([data-scroll-lock]); this keeps the scroll position.
	const scrollLock = (on) => {
		if (on === (lockedAt !== null)) return;
		if (on) {
			lockedAt = window.scrollY;
			root.style.setProperty('--locked-at', `${-lockedAt}px`);
			// The value keeps a classic scrollbar on a page that has one, so nothing shifts.
			root.dataset.scrollLock = root.scrollHeight > root.clientHeight ? 'scrollbar' : '';
		} else {
			delete root.dataset.scrollLock;
			root.style.removeProperty('--locked-at');
			window.scrollTo({ top: lockedAt, behavior: 'instant' });
			lockedAt = null;
		}
	};

	// The drawer looks modal, so it behaves modal: nothing behind it scrolls or is tabbable.
	const modal = (on) => {
		content?.toggleAttribute('inert', on);
		scrollLock(on);
	};

	// Click beside the drawer. The toggle is skipped: it already toggles itself.
	document.addEventListener('click', (e) => {
		if (nav.contains(e.target) || e.target.closest('.nav-toggle')) return;
		nav.panel?.close(e);
	});

	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') nav.panel?.close(e);
	});

	// The check on the target matters, because the nav sections are panels whose events bubble.
	nav.addEventListener('panel:opening', (e) => e.target === nav && modal(true));
	nav.addEventListener('panel:closed', (e) => e.target === nav && modal(false));
	// Resizing to desktop makes it static, which is not a close, so release here.
	nav.addEventListener('panel:staticchange', () => modal(false));
});

// Highlight. Exclude the install wizard, and any block JS writes itself (.live-code): hljs rebuilds a block from its text, which would throw away the <mark> elements the static demo puts there.
hljs.configure({ cssSelector: 'pre code:not(.iw-code):not(.live-code)' });
hljs.highlightAll();
hljs.initLineNumbersOnLoad();
