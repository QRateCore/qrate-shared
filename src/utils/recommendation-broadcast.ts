/**
 * Cross-tab broadcast for recommendation mutations.
 *
 * When any tab accepts, removes, or modifies recommendations via
 * `updateItemModifiers`, it broadcasts the affected item ID so other
 * tabs with the edit modal open can refetch.
 *
 * Uses BroadcastChannel (supported in all modern browsers).
 * Falls back to a no-op on unsupported environments (SSR, old browsers).
 */

const CHANNEL_NAME = 'qrate:recommendation-change';

export interface RecommendationChangeMessage {
  /** The menu item whose recommendations changed. */
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
 * Notify other tabs that recommendations changed for a given item.
 * Call this after a successful `updateItemModifiers` that includes recommendations.
 */
export function broadcastRecommendationChange(itemId: string, restaurantId: string): void {
  const ch = getChannel();
  if (!ch) return;
  const msg: RecommendationChangeMessage = { itemId, restaurantId, timestamp: Date.now() };
  ch.postMessage(msg);
}

/**
 * Subscribe to recommendation changes from other tabs.
 * Returns an unsubscribe function.
 */
export function onRecommendationChange(
  callback: (msg: RecommendationChangeMessage) => void,
): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const handler = (event: MessageEvent<RecommendationChangeMessage>) => {
    callback(event.data);
  };
  ch.addEventListener('message', handler);
  return () => ch.removeEventListener('message', handler);
}
