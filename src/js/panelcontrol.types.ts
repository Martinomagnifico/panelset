export interface PanelControlConfig {
	/** CSS selector for init(). Defaults to '[data-panelcontrol]'. */
	selector?: string;
	/**
	 * How the keyboard activates a tab.
	 * - 'manual' (the default): the arrows move focus, and Enter, Space or a click activates.
	 * - 'auto': the arrows move focus AND activate. It falls back to manual whenever the PanelSet uses autoFocus or async content, since activating on every arrow press would fight focus, or set off a load per tab.
	 */
	activation?: 'manual' | 'auto';
	/** Verbose console logging. */
	debug?: boolean;
}
