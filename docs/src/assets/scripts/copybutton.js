
// Copy to clipboard functionality for code blocks
document.addEventListener('click', async (e) => {
	const button = e.target.closest('button.copy');
	if (!button) return;

	const demo = button.closest('.code-block');
	if (!demo) return;

	const codeContainer = demo.querySelector('pre code');
	if (!codeContainer) return;

	let content = null;

	const hljsTable = codeContainer.querySelector("table.hljs-ln");
	if (hljsTable) {
		// Extract only code content, not line numbers
		content = Array.from(hljsTable.querySelectorAll("td.hljs-ln-code"))
			.map((cell) => cell.textContent)
			.join("\n");
	} else {
		content = codeContainer.textContent.replace(/^\s+|\s+$/g, "");
	}

	const originalContent = button.innerHTML;
	
	try {
		await navigator.clipboard.writeText(content);
		
		button.innerHTML = 'Copied!';
		button.classList.add('copied');

	} catch (err) {
		console.error('Failed to copy text: ', err);
		button.innerHTML = 'Failed!';
		button.classList.add('error');

	} finally {
		setTimeout(() => {
			button.innerHTML = originalContent;
			button.classList.remove('copied', 'error');
		}, 1000);
	}
});
