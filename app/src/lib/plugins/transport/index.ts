export { Channel, Transport } from './types';
export type { WireMessage } from './types';
export { ChannelImpl } from './channel';
export { HostTransport } from './host';
// GuestTransport is intentionally NOT exported from barrel.
// It runs inside the plugin iframe — not part of the host bundle.
