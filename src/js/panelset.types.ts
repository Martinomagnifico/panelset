import type { AutoFocusMode } from './functions/focus.js';

export interface PanelSetConfig {
	selector?: string;
	align?: 'start' | 'end' | 'center';
	transitions?: boolean | {
		panels?: boolean;
		height?: boolean;
	};
	levels?: boolean;
	loop?: boolean;
	closable?: boolean;
	closeOnTab?: boolean;
	disabledMode?: 'aria' | 'native';
	loadingHeight?: number;
	loadingDelay?: number;
	customIndicator?: boolean;
	returnFocus?: boolean;
	autoFocus?: AutoFocusMode;
	persist?: boolean;
	deepLink?: boolean;
	interruptible?: boolean;
	manageTriggers?: boolean;
	manageLabels?: boolean;
	debug?: boolean;
}

export interface ReadyEventDetail {
	container: HTMLElement;
	instance: import('./panelset.js').PanelSet;
}

export interface BeforeActivateEventDetail {
	/** ID of the panel about to be activated. */
	panelId: string;
	/** The panel about to be activated. */
	targetPanel: HTMLElement;
	/** The currently active panel, if any. */
	outgoingPanel: HTMLElement | null;
	/** The button or tab that set this off, or null when your code called it without an event. */
	trigger: HTMLElement | null;
}

export interface BeforeOpenEventDetail {
	panelId: string;
	targetPanel: HTMLElement;
	outgoingPanel: HTMLElement | null;
	signal: AbortSignal;
	/** What the open actually waits on. Use waitUntil() instead. */
	promise: Promise<unknown> | null;
	/** Hold the open until p resolves. Call it as often as you like: the open waits for all of them. */
	waitUntil(p: Promise<unknown>): void;
}

export interface ActivationEventDetail {
	panelId: string;
	trigger: HTMLElement | null;
	outgoingPanel: HTMLElement | null;
	/** Where the panel sits in DOM order, counting from 0. */
	index: number;
	/** How many panels the set holds. */
	total: number;
	/** True when this is the first panel. */
	atStart: boolean;
	/** True when this is the last one. */
	atEnd: boolean;
}

export interface ActivationAbortedEventDetail {
	panelId: string;
	trigger: HTMLElement | null;
}

export interface HandlerOptions {
	once?: boolean;
}

export interface ShowOptions {
	event?: Event;
	transition?: boolean;
	autoFocus?: AutoFocusMode;
	direction?: 'forward' | 'backward';
}

export type AsyncContentHandler = (
	targetPanel: HTMLElement,
	signal: AbortSignal
) => Promise<void> | void;
