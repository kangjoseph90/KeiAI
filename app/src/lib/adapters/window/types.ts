/**
 * Window Adapter Interface
 *
 * Used for managing the application window state (minimize, maximize, close, title).
 */
export interface IWindowAdapter {
	minimize(): Promise<void>;
	maximize(): Promise<void>;
	unmaximize(): Promise<void>;
	close(): Promise<void>;
	setTitle(title: string): Promise<void>;
	setAlwaysOnTop(alwaysOnTop: boolean): Promise<void>;
}
