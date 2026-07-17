import type { AutoFocusMode } from './functions/focus.js';

export interface PanelConfig {
	axis?: 'vertical' | 'horizontal';
	align?: 'start' | 'end' | 'center';
	closeOnResize?: boolean;
	transitions?: boolean;
	autoFocus?: AutoFocusMode;
	returnFocus?: boolean;
	closeSiblings?: boolean;
	loadingDelay?: number;
	loadingHeight?: number;
	interruptible?: boolean;
	persist?: boolean;
	deepLink?: boolean;
	customIndicator?: boolean;
	static?: boolean | string;
	debug?: boolean;
}

export interface BeforeOpenEventDetail {
	signal: AbortSignal;
	/** What the open actually waits on. Use waitUntil() instead. */
	promise: Promise<unknown> | null;
	/** Hold the open until p resolves. Call it as often as you like: the open waits for all of them. */
	waitUntil(p: Promise<unknown>): void;
	trigger: HTMLElement | null;
}

export interface PanelEventDetail {
	trigger: HTMLElement | null;
}

/** The detail of `panel:staticchange`, which fires when the panel turns static or collapsible again. Not on init: that is where it starts, not a change. */

export interface PanelStaticEventDetail {
	static: boolean;
}

export type AsyncOpenHandler = (
	element: HTMLElement,
	signal: AbortSignal
) => Promise<void> | void;
