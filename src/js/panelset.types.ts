import type { AutoFocusMode } from './functions/focus.js';

export interface PanelSetConfig {
	selector?: string;
	align?: 'start' | 'end' | 'center';
	transitions?: boolean | {
		panels?: boolean;
		height?: boolean;
	};
	/** Slide in the direction you are travelling. The DOM order sets the levels (a later panel is higher), and .levelup or .leveldown goes on the panels so CSS can reverse the transform on the way back. False by default. */
	levels?: boolean;
	/** Let next() and prev() come round at the ends, last to first and back again. False by default, so they stop. */
	loop?: boolean;
	closable?: boolean;
	closeOnTab?: boolean;
	/** How PanelSet turns its own buttons (data-ps-next, -prev, -close) off at the ends. 'aria' (the default) toggles aria-disabled and leaves the real disabled attribute to you. 'native' toggles the real disabled attribute (PanelSet owns it) and leaves aria-disabled to you. Locking a tab strip is PanelControl's business, and always aria. */
	disabledMode?: 'aria' | 'native';
	loadingHeight?: number;
	loadingDelay?: number;
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
	/** Pick which way the levels slide, whatever the DOM order says. next() and prev() set it, so coming round the end still slides the way you were going ('forward' looks like Next, even landing on an earlier panel). Only matters for sets with levels. */
	direction?: 'forward' | 'backward';
}

export type AsyncContentHandler = (
	targetPanel: HTMLElement,
	signal: AbortSignal
) => Promise<void> | void;
