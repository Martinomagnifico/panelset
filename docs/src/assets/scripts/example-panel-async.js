function renderRecipe(data) {
	return `
		<hr>
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

function slowFetch(url, options = {}, delayMs = 1500) {
	console.log("100");
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			fetch(url, options).then(resolve).catch(reject);
		}, delayMs);
		options.signal?.addEventListener('abort', () => clearTimeout(timeout));
	});
}

function randomInt(min, max) {
	return Math.floor(Math.random() * (max - min + 1) + min);
}

const panelEl = document.getElementById('async-panel-recipe');

panelEl?.panel?.onBeforeOpen((el, signal) => {
	return slowFetch(`https://dummyjson.com/recipes/${randomInt(1, 10)}`, { signal })
		.then(r => r.json())
		.then(data => {
			el.querySelector('.panel-wrapper').innerHTML = renderRecipe(data);
		});
}, { once: true });

// Other example that can be used, using a simple timeout to simulate loading time without fetching data:

// panelEl?.panel?.onBeforeOpen((el, signal) => {
//     return new Promise(res => setTimeout(() => {
//         el.querySelector('.panel-wrapper').innerHTML = '<h2>Fast content</h2>';
//         res();
//     }, 250));
// }, { once: true });