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

	if (ids.length) {
		url.searchParams.set('panel', ids.join(','));
	} else {
		url.searchParams.delete('panel');
	}

	history.replaceState(null, '', url);
};


// localStorage

export const readStored = (key: string): string | null =>
	localStorage.getItem(key);

export const writeStored = (key: string, value: string): void =>
	localStorage.setItem(key, value);