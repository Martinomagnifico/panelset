/**
 * URL param + localStorage.
 */


// URL param

export const readPanelParam = (): string[] => {
	const value = new URLSearchParams(location.search).get('panel');
	return value ? value.split(',').filter(Boolean) : [];
};

// Rewrites the list so it holds exactly activeIds out of the ids belonging to the caller. Anything else in the param is another component's business and is left where it is, so a Panel and a PanelSet on one page do not overwrite each other. Writes nothing when the result is what is already there, or every switch would push a history entry saying the same thing.
export const setPanelParam = (myIds: string[], activeIds: string[]): void => {
	const mine = new Set(myIds);
	const current = readPanelParam();
	const next = [...current.filter(id => !mine.has(id)), ...activeIds].filter(Boolean);

	if (next.length === current.length && next.every((id, i) => id === current[i])) return;
	writePanelParam(next);
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
// Keys carry the page's path, so ids the library hands out itself (panel-1, panel-2) cannot collide across pages in shared storage. A panel remembered on /accordion stays apart from a panel-1 on /intro.

const pageScope = (key: string): string => `${location.pathname}::${key}`;

export const readStored = (key: string): string | null =>
	localStorage.getItem(pageScope(key));

export const writeStored = (key: string, value: string): void =>
	localStorage.setItem(pageScope(key), value);