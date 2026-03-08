/**
 * Notification Adapter Interface
 *
 * Used for sending OS-level notifications and managing permissions.
 */
export interface INotificationAdapter {
	show(title: string, body?: string, icon?: string): Promise<void>;
	requestPermission(): Promise<boolean>;
}
