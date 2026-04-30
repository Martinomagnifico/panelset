import type { AutoFocusMode } from './functions/focus';

export interface PanelSetConfig {
	selector?: string;
	align?: 'start' | 'end' | 'center';
	transitions?: boolean | {
		panels?: boolean;
		height?: boolean;
	};
	closable?: boolean;
	closeOnTab?: boolean;
	loadingHeight?: number;
	loadingDelay?: number;
	returnFocus?: boolean;
	autoFocus?: AutoFocusMode;
	persist?: boolean;
	debug?: boolean;
}

export interface ReadyEventDetail {
	container: HTMLElement;
	instance: import('./panelset').PanelSet;
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
