type AttrType = 'string' | 'boolean' | 'number' | 'json';

/** Maps each config key to its [dataset key, value type]. */
export type AttrMap<T> = {
	[K in keyof T]?: [datasetKey: string, type: AttrType];
};

function _coerce(value: string, type: AttrType): unknown {
	switch (type) {
		case 'string':  return value;
		case 'boolean': return value !== 'false';
		case 'number':  return parseInt(value, 10);
		case 'json':
			try { return JSON.parse(value); }
			catch { return value !== 'false'; }
	}
}

/**
 * Read data attributes off a DOMStringMap into a config object. Every entry pairs a config key with a [datasetKey, type].
 */
export function parseDataAttrs<T>(dataset: DOMStringMap, attrMap: AttrMap<T>): Partial<T> {
	const config: Partial<T> = {};
	for (const [configKey, entry] of Object.entries(attrMap) as [keyof T & string, [string, AttrType]][]) {
		const [datasetKey, type] = entry;
		const value = dataset[datasetKey];
		if (value === undefined) continue;
		(config as Record<string, unknown>)[configKey] = _coerce(value, type);
	}
	return config;
}

/**
 * The same for plain element attributes: same AttrMap, but it reads element.getAttribute() instead of the dataset, turning the datasetKey from camelCase into kebab-case ("panelAxis" becomes "panel-axis").
 */
export function parseAttrs<T>(element: Element, attrMap: AttrMap<T>): Partial<T> {
	const config: Partial<T> = {};
	for (const [configKey, entry] of Object.entries(attrMap) as [keyof T & string, [string, AttrType]][]) {
		const [datasetKey, type] = entry;
		const attrName = datasetKey.replace(/([A-Z])/g, '-$1').toLowerCase();
		const value = element.getAttribute(attrName);
		if (value === null) continue;
		(config as Record<string, unknown>)[configKey] = _coerce(value, type);
	}
	return config;
}
