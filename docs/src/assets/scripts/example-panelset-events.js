document.addEventListener('click', event => {
	const button = event.target.closest('button[aria-controls]');
	if (!button) return;
	const panelId = button.getAttribute('aria-controls');
	const container = document.getElementById(panelId)?.closest('[data-panelset]');
	container?.panelSet?.show(panelId, { event });
});

const demo  = document.getElementById('ev-vid-demo');
const video = demo.querySelector('video');

demo.addEventListener('ps:activationstart', e => {
	console.log('ps:activationstart', e.detail.panelId);
	if (e.detail.panelId !== 'ev-vid-panel-2') video.pause();
});
demo.addEventListener('ps:activationcomplete', e => {
	console.log('ps:activationcomplete', e.detail.panelId);
	if (e.detail.panelId === 'ev-vid-panel-2') {
		video.play();
	} else {
		video.currentTime = 0;
	}
});
