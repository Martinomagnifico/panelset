export interface PanelControlConfig {
	/** CSS selector for init(). Defaults to '[data-panelcontrol]'. */
	selector?: string;
	/**
	 * Keyboard activation for tablist controls.
	 * - 'manual' (default): arrow keys move focus; Enter/Space (or click) activates.
	 * - 'auto': arrow keys move focus AND activate — but auto self-downgrades to
	 *   manual whenever the PanelSet uses autoFocus or async content, since
	 *   activating on every arrow would fight focus or fire loads.
	 */
	activation?: 'manual' | 'auto';
	/** Verbose console logging. */
	debug?: boolean;
}
