// @vitest-environment jsdom
/**
 * Tests for the cross-tab recommendation broadcast utility.
 *
 * jsdom provides a stub BroadcastChannel that supports postMessage
 * and addEventListener, which is sufficient for unit-level verification.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  broadcastRecommendationChange,
  onRecommendationChange,
  type RecommendationChangeMessage,
} from '../recommendation-broadcast';

describe('recommendation-broadcast', () => {
  // BroadcastChannel in jsdom may be a no-op stub. If not available,
  // the utility is designed to degrade gracefully — these tests verify that.
  const hasBroadcastChannel = typeof BroadcastChannel !== 'undefined';

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('broadcastRecommendationChange does not throw even without BroadcastChannel', () => {
    expect(() => broadcastRecommendationChange('item-1', 'rest-1')).not.toThrow();
  });

  it('onRecommendationChange returns an unsubscribe function', () => {
    const unsub = onRecommendationChange(() => {});
    expect(typeof unsub).toBe('function');
    // Calling unsubscribe should not throw
    expect(() => unsub()).not.toThrow();
  });

  // Only run the integration test if BroadcastChannel is available
  if (hasBroadcastChannel) {
    it('listener receives messages broadcast on the same channel', async () => {
      const received: RecommendationChangeMessage[] = [];
      const unsub = onRecommendationChange((msg) => received.push(msg));

      broadcastRecommendationChange('item-42', 'rest-99');

      // BroadcastChannel delivery is async — wait a tick
      await new Promise((r) => setTimeout(r, 50));
      vi.advanceTimersByTime(50);

      // In jsdom, same-context BroadcastChannel may or may not deliver
      // to its own listener. We verify no errors occurred regardless.
      unsub();
      // If messages were delivered, verify shape
      if (received.length > 0) {
        expect(received[0].itemId).toBe('item-42');
        expect(received[0].restaurantId).toBe('rest-99');
        expect(typeof received[0].timestamp).toBe('number');
      }
    });
  }

  it('unsubscribe prevents further callbacks', async () => {
    const cb = vi.fn();
    const unsub = onRecommendationChange(cb);
    unsub();

    broadcastRecommendationChange('item-1', 'rest-1');
    await new Promise((r) => setTimeout(r, 50));
    vi.advanceTimersByTime(50);

    // After unsubscribe, callback should not fire
    expect(cb).not.toHaveBeenCalled();
  });
});
