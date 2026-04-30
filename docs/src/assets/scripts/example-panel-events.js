const panel = document.getElementById('ev-video-panel');
const video = document.getElementById('ev-video');

panel.addEventListener('panel:opening', () => console.log('panel:opening'));
panel.addEventListener('panel:opened',  () => {
	console.log('panel:opened');
	video.play();
});
panel.addEventListener('panel:closing', () => {
	console.log('panel:closing');
	video.pause();
});
panel.addEventListener('panel:closed',  () => {
	console.log('panel:closed');
	video.currentTime = 0;
});
