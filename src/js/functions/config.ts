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
 * Parse data attributes from a DOMStringMap into a partial config object.
 * Each entry maps a config key to a [datasetKey, type] pair.
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
 * Parse plain element attributes into a partial config object.
 * Uses the same AttrMap as parseDataAttrs but reads from element.getAttribute()
 * instead of dataset. The datasetKey is converted from camelCase to kebab-case
 * to form the attribute name (e.g. "panelAxis" → "panel-axis").
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
