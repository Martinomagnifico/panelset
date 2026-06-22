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
	debug?: boolean;
}

export interface BeforeOpenEventDetail {
	signal: AbortSignal;
	/** Underlying mechanism the open awaits; prefer waitUntil(). */
	promise: Promise<unknown> | null;
	/** Delay the open until p resolves. May be called more than once (awaits all). */
	waitUntil(p: Promise<unknown>): void;
	trigger: HTMLElement | null;
}

export interface PanelEventDetail {
	trigger: HTMLElement | null;
}

export type AsyncOpenHandler = (
	element: HTMLElement,
	signal: AbortSignal
) => Promise<void> | void;
