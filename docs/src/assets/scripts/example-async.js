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





// EVENT WAY:
// THIS IS COMMENTED OUT, BUT LEFT HERE FOR REFERENCE

// slowDemo.addEventListener('ps:beforeopen', (e) => {
// 	const { panelId, targetPanel, signal } = e.detail;

// 	// Skip if already loaded
// 	if (targetPanel.dataset.loaded === 'true') {
// 		console.log(`Panel ${panelId} already loaded`);
// 		return;
// 	}

// 	if (targetPanel.id === 'async-panel-2') {
// 		// Just assign the fetch promise directly - no wrapping needed
// 		e.detail.promise = slowfetch(`https://dummyjson.com/recipes/${randomIntFromInterval(1, 10)}`, { signal })
// 		.then(response => response.json())
// 		.then(data => {
// 			targetPanel.innerHTML = renderRecipe(data);
// 			targetPanel.dataset.loaded = 'true';
// 		})
// 		.catch(error => {
// 			if (error.name === 'AbortError') {
// 			console.log(`Load cancelled for ${panelId}`);
// 			} else {
// 			console.error(`Load failed for ${panelId}:`, error);
// 			}
// 			// Re-throw so PanelSet can handle it
// 			throw error;
// 		});
// 	}
// });



// document.addEventListener('ps:beforeopen', (e) => {
//   const { instance, container, panelId, targetPanel, signal } = e.detail;

//   if (panelId == 'async-panel-2') {

// 	// Skip if already loaded
// 	if (targetPanel.dataset.loaded === 'true') {
// 		console.log(`Panel ${panelId} already loaded`);
// 		return;
// 	}
// 	console.log(`Loading content for ${panelId}...`);
// 	// Simulate slow API call
// 	e.detail.promise = new Promise((resolve, reject) => {
// 		const timeout = setTimeout(() => {
// 		// Simulate loaded content
// 		targetPanel.innerHTML = `
// 			<h3>Loaded: ${panelId}</h3>
// 			<p>This content was loaded asynchronously!</p>
// 			<p>Loaded at: ${new Date().toLocaleTimeString()}</p>
// 		`;
// 		targetPanel.dataset.loaded = 'true';
// 			resolve();
// 		}, 2000);  // 2 second delay

// 		// Handle abort (rapid clicks)
// 		signal.addEventListener('abort', () => {
// 			console.log(`Load cancelled for ${panelId}`);
// 			clearTimeout(timeout);
// 			reject(new Error('Aborted'));
// 		});
// 	});

//   }

// })

// Log all events

document.addEventListener('ps:ready', (e) => {
	console.log('This panelset is ready:', e.detail.panelId);
});

document.addEventListener('ps:beforeopen', (e) => {
	console.log('Before doing any transitions:', e.detail.panelId);
});

document.addEventListener('ps:activationstart', (e) => {
	console.log('Started a transition:', e.detail.panelId);
});

document.addEventListener('ps:activationcomplete', (e) => {
	console.log('Completed a transition:', e.detail.panelId);
});

document.addEventListener('ps:activationaborted', (e) => {
	console.log('Aborted the loading of a panel:', e.detail.panelId);
});
