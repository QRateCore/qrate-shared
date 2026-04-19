/**
 * Cross-tab broadcast for addon mutations.
 *
 * When any tab adds, removes, or modifies addons on a menu item via
 * `updateItemModifiers`, it broadcasts the affected item ID so other
 * tabs with the edit modal open can refetch the addon pool.
 *
 * Uses BroadcastChannel (supported in all modern browsers).
 * Falls back to a no-op on unsupported environments (SSR, old browsers).
 */

const CHANNEL_NAME = 'qrate:addon-change';

export interface AddonChangeMessage {
  /** The menu item whose addons changed. */
  itemId: string;
  /** The restaurant scope — listeners can ignore messages for other restaurants. */
  restaurantId: string;
  /** Epoch ms — lets the listener ignore stale messages. */
  timestamp: number;
}

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
  }
  return channel;
}

/**
 * Notify other tabs that addons changed for a given item.
 * Call this after a successful `updateItemModifiers` that includes addons.
 */
export function broadcastAddonChange(itemId: string, restaurantId: string): void {
  const ch = getChannel();
  if (!ch) return;
  const msg: AddonChangeMessage = { itemId, restaurantId, timestamp: Date.now() };
  ch.postMessage(msg);
}

/**
 * Subscribe to addon changes from other tabs.
 * Returns an unsubscribe function.
 */
export function onAddonChange(
  callback: (msg: AddonChangeMessage) => void,
): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const handler = (event: MessageEvent<AddonChangeMessage>) => {
    callback(event.data);
  };
  ch.addEventListener('message', handler);
  return () => ch.removeEventListener('message', handler);
}
