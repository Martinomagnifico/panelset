/**
 * URL param + localStorage.
 */


// URL param

export const readPanelParam = (): string[] => {
	const value = new URLSearchParams(location.search).get('panel');
	return value ? value.split(',').filter(Boolean) : [];
};

export const writePanelParam = (ids: string[]): void => {
	const url = new URL(location.href);
	url.searchParams.delete('panel');

	if (ids.length) {
		const sep = url.search ? '&' : '?';
		history.replaceState(null, '', `${url}${sep}panel=${ids.join(',')}`);
	} else {
		history.replaceState(null, '', url);
	}
};


// localStorage
//
// Keys are scoped to the current page path so that auto-assigned ids
// (panel-1, panel-2, …) on different pages don't collide in shared storage.
// A panel persisted on /accordion stays distinct from a panel-1 on /intro.

const pageScope = (key: string): string => `${location.pathname}::${key}`;

export const readStored = (key: string): string | null =>
	localStorage.getItem(pageScope(key));

export const writeStored = (key: string, value: string): void =>
	localStorage.setItem(pageScope(key), value);