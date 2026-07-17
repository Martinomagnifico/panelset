function renderRecipe(data) {
	return `
        <h2>${data.name}</h2>
        <div class="recipe-meta">
            <span>⏱️ ${data.prepTimeMinutes + data.cookTimeMinutes} mins</span>
            <span>👥 ${data.servings} servings</span>
            <span>🔥 ${data.caloriesPerServing} cal</span>
            <span>⭐ ${data.rating} (${data.reviewCount} reviews)</span>
        </div>
        <div class="recipe">
            <img class="recipe-image" src="${data.image}" alt="${data.name}">
            <div class="recipe-ingredients">
                <h3>Ingredients</h3>
                <ul>
                    ${data.ingredients.map(ing => `<li>${ing}</li>`).join('')}
                </ul>
            </div>
        </div>
        <div class="recipe-instructions">
            <h3>Instructions</h3>
            <ol>
                ${data.instructions.map(step => `<li>${step}</li>`).join('')}
            </ol>
        </div>
    `;
}

document.addEventListener('click', e => {
	const button = e.target.closest('button[aria-controls]');
	if (!button) return;

	const panelId = button.getAttribute('aria-controls');
	const container = document.getElementById(panelId)?.closest('[data-panelset]');

	container?.panelSet?.show(panelId, e, true, { trigger: button });
});

function slowfetch(url, options = {}, delayMs = 1500) {
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			fetch(url, options)
				.then(resolve)
				.catch(reject);
		}, delayMs);
	});
}

function randomIntFromInterval(min, max) {
	return Math.floor(Math.random() * (max - min + 1) + min);
}

const asyncDemo = document.getElementById('async-demo');

function setupAsyncDemo(instance) {
	instance.onBeforeOpen((targetPanel, signal) => {
		if (targetPanel.id === 'async-panel-2') {
			return slowfetch(`https://dummyjson.com/recipes/${randomIntFromInterval(1, 10)}`, { signal })
				.then(response => response.json())
				.then(data => {
					targetPanel.innerHTML = renderRecipe(data);
				});
		}
	}, { once: false });
}

if (asyncDemo.panelSet) {
	setupAsyncDemo(asyncDemo.panelSet);
} else {
	asyncDemo.addEventListener('ps:ready', (e) => setupAsyncDemo(e.detail.instance), { once: true });
}

