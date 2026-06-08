import type { AutoFocusMode } from './functions/focus';

export interface PanelSetConfig {
	selector?: string;
	align?: 'start' | 'end' | 'center';
	transitions?: boolean | {
		panels?: boolean;
		height?: boolean;
	};
	/** Enable level-based slide direction. DOM order defines the level
	 *  (later panel = higher). Adds .levelup / .leveldown to the panels so
	 *  CSS can reverse the transform on backward navigation. Default false. */
	levels?: boolean;
	/** Make next() / prev() wrap around the ends (last → first, first → last).
	 *  Default false: they stop at the first and last panel. */
	loop?: boolean;
	closable?: boolean;
	closeOnTab?: boolean;
	loadingHeight?: number;
	loadingDelay?: number;
	returnFocus?: boolean;
	autoFocus?: AutoFocusMode;
	persist?: boolean;
	deepLink?: boolean;
	interruptible?: boolean;
	manageTriggers?: boolean;
	debug?: boolean;
}

export interface ReadyEventDetail {
	container: HTMLElement;
	instance: import('./panelset').PanelSet;
}

export interface BeforeActivateEventDetail {
	/** ID of the panel about to be activated. */
	panelId: string;
	/** The panel about to be activated. */
	targetPanel: HTMLElement;
	/** The currently active panel, if any. */
	outgoingPanel: HTMLElement | null;
	/** The element that triggered the activation (button/tab), or null when
	 *  called programmatically without an event. */
	trigger: HTMLElement | null;
}

export interface BeforeOpenEventDetail {
	panelId: string;
	targetPanel: HTMLElement;
	outgoingPanel: HTMLElement | null;
	signal: AbortSignal;
	promise: Promise<void> | null;
}

export interface ActivationEventDetail {
	panelId: string;
	trigger: HTMLElement | null;
	outgoingPanel: HTMLElement | null;
	/** Zero-based index of the activated panel in DOM order. */
	index: number;
	/** Total number of panels in the set. */
	total: number;
	/** True when the activated panel is the first one. */
	atStart: boolean;
	/** True when the activated panel is the last one. */
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
}

export type AsyncContentHandler = (
	targetPanel: HTMLElement,
	signal: AbortSignal
) => Promise<void> | void;
