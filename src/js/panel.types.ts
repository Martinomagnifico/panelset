import type { AutoFocusMode } from './functions/focus';

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
	promise: Promise<void> | null;
	trigger: HTMLElement | null;
}

export interface PanelEventDetail {
	trigger: HTMLElement | null;
}

export type AsyncOpenHandler = (
	element: HTMLElement,
	signal: AbortSignal
) => Promise<void> | void;
