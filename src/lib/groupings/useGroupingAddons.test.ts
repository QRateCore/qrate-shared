/**
 * Tests for useGroupingAddons (PDD Phase C Step 5).
 *
 * Covers:
 *   - Pure function shape projection: empty / present / mixed
 *   - Default value handling (price_override null → 0, status missing → 'approved')
 *   - Hook memoisation: identity-stable when groupings ref unchanged
 *   - EMPTY sentinel: stable identity across calls with null/undefined
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  getAddonsFromGroupings,
  useGroupingAddons,
  type AddonView,
  type ItemWithGroupingsAndItems,
} from './useGroupingAddons';

// ── Helpers ──────────────────────────────────────────────────────────

type GroupingItemForTest = NonNullable<
  NonNullable<ItemWithGroupingsAndItems['groupings']>[number]['items']
>[number];
type GroupingForTest = NonNullable<ItemWithGroupingsAndItems['groupings']>[number];

function makeItem(groupings?: GroupingForTest[]): ItemWithGroupingsAndItems {
  return { groupings };
}

function makeAddonsGrouping(items: Partial<GroupingItemForTest>[]): GroupingForTest {
  return {
    kind: 'addons',
    items: items.map((p, i) => ({
      menu_item_id: `addon-${i}`,
      ...p,
    })),
  };
}

// ── getAddonsFromGroupings — pure function ───────────────────────────

describe('getAddonsFromGroupings', () => {
  it('returns empty for null/undefined item', () => {
    expect(getAddonsFromGroupings(null)).toHaveLength(0);
    expect(getAddonsFromGroupings(undefined)).toHaveLength(0);
  });

  it('returns empty when item has no groupings', () => {
    expect(getAddonsFromGroupings(makeItem())).toHaveLength(0);
    expect(getAddonsFromGroupings(makeItem([]))).toHaveLength(0);
  });

  it('returns empty when no addons grouping is present', () => {
    const sidesOnly: GroupingForTest = {
      kind: 'sides_and',
      items: [{ menu_item_id: 'side-1', name: 'Fries' }],
    };
    expect(getAddonsFromGroupings(makeItem([sidesOnly]))).toHaveLength(0);
  });

  it('returns empty when addons grouping is empty', () => {
    expect(getAddonsFromGroupings(makeItem([makeAddonsGrouping([])]))).toHaveLength(0);
  });

  it('projects all items in addons grouping to AddonView shape', () => {
    const item = makeItem([
      makeAddonsGrouping([
        {
          menu_item_id: 'addon-cheese',
          name: 'Extra Cheese',
          price_override: 1.5,
          thumbnail_url: 'https://example.com/cheese.png',
          status: 'approved',
          suggestion_source: 'manual',
        },
        {
          menu_item_id: 'addon-bacon',
          name: 'Crispy Bacon',
          price_override: 2.0,
          thumbnail_url: null,
          status: 'suggested',
          suggestion_source: 'ai',
        },
      ]),
    ]);
    const addons = getAddonsFromGroupings(item);
    expect(addons).toHaveLength(2);
    expect(addons[0]).toEqual<AddonView>({
      menu_item_id: 'addon-cheese',
      name: 'Extra Cheese',
      price_override: 1.5,
      thumbnail_url: 'https://example.com/cheese.png',
      status: 'approved',
      suggestion_source: 'manual',
    });
    expect(addons[1].suggestion_source).toBe('ai');
  });

  it('defaults missing price_override to 0 (legacy AddonEntry contract)', () => {
    const item = makeItem([
      makeAddonsGrouping([{ menu_item_id: 'addon-1', name: 'Free Topping' }]),
    ]);
    expect(getAddonsFromGroupings(item)[0].price_override).toBe(0);
  });

  it('defaults null price_override to 0', () => {
    const item = makeItem([
      makeAddonsGrouping([
        { menu_item_id: 'addon-1', name: 'Free Topping', price_override: null },
      ]),
    ]);
    expect(getAddonsFromGroupings(item)[0].price_override).toBe(0);
  });

  it('defaults missing thumbnail_url to null', () => {
    const item = makeItem([
      makeAddonsGrouping([{ menu_item_id: 'addon-1', name: 'No Image' }]),
    ]);
    expect(getAddonsFromGroupings(item)[0].thumbnail_url).toBeNull();
  });

  it('defaults missing status to approved', () => {
    const item = makeItem([
      makeAddonsGrouping([{ menu_item_id: 'addon-1', name: 'Default' }]),
    ]);
    expect(getAddonsFromGroupings(item)[0].status).toBe('approved');
  });

  it('defaults missing suggestion_source to manual', () => {
    const item = makeItem([
      makeAddonsGrouping([{ menu_item_id: 'addon-1', name: 'Default' }]),
    ]);
    expect(getAddonsFromGroupings(item)[0].suggestion_source).toBe('manual');
  });

  it('defaults missing name to empty string', () => {
    const item = makeItem([
      makeAddonsGrouping([{ menu_item_id: 'addon-1' }]),
    ]);
    expect(getAddonsFromGroupings(item)[0].name).toBe('');
  });

  it('finds addons grouping among multiple grouping kinds', () => {
    const sides: GroupingForTest = {
      kind: 'sides_or',
      items: [{ menu_item_id: 'side-1', name: 'Fries' }],
    };
    const recs: GroupingForTest = {
      kind: 'recommendations',
      items: [{ menu_item_id: 'rec-1', name: 'Pair' }],
    };
    const addons = makeAddonsGrouping([
      { menu_item_id: 'addon-1', name: 'Cheese' },
    ]);
    const item = makeItem([sides, recs, addons]);
    const result = getAddonsFromGroupings(item);
    expect(result).toHaveLength(1);
    expect(result[0].menu_item_id).toBe('addon-1');
  });

  it('returns same EMPTY reference across no-data calls (identity stable)', () => {
    const a = getAddonsFromGroupings(null);
    const b = getAddonsFromGroupings(undefined);
    const c = getAddonsFromGroupings(makeItem());
    const d = getAddonsFromGroupings(makeItem([]));
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(c).toBe(d);
  });
});

// ── useGroupingAddons — hook memoisation ─────────────────────────────

describe('useGroupingAddons', () => {
  it('returns empty array for null/undefined item', () => {
    const { result } = renderHook(() => useGroupingAddons(undefined));
    expect(result.current).toHaveLength(0);
  });

  it('returns memoised array reference across renders with same groupings ref', () => {
    const groupings = [
      makeAddonsGrouping([{ menu_item_id: 'a-1', name: 'Cheese' }]),
    ];
    const item = makeItem(groupings);
    const { result, rerender } = renderHook(({ i }) => useGroupingAddons(i), {
      initialProps: { i: item },
    });
    const firstResult = result.current;
    rerender({ i: item });
    expect(result.current).toBe(firstResult);
  });

  it('returns new array reference when groupings ref changes', () => {
    const item1 = makeItem([
      makeAddonsGrouping([{ menu_item_id: 'a-1', name: 'Cheese' }]),
    ]);
    const item2 = makeItem([
      makeAddonsGrouping([{ menu_item_id: 'a-2', name: 'Bacon' }]),
    ]);
    const { result, rerender } = renderHook(({ i }) => useGroupingAddons(i), {
      initialProps: { i: item1 },
    });
    const firstResult = result.current;
    rerender({ i: item2 });
    expect(result.current).not.toBe(firstResult);
    expect(result.current[0].menu_item_id).toBe('a-2');
  });

  it('handles transitions from null → present groupings', () => {
    const { result, rerender } = renderHook(
      ({ i }: { i: ItemWithGroupingsAndItems | undefined }) => useGroupingAddons(i),
      { initialProps: { i: undefined as ItemWithGroupingsAndItems | undefined } },
    );
    expect(result.current).toHaveLength(0);

    const item = makeItem([
      makeAddonsGrouping([{ menu_item_id: 'a-1', name: 'Cheese' }]),
    ]);
    rerender({ i: item });
    expect(result.current).toHaveLength(1);
    expect(result.current[0].menu_item_id).toBe('a-1');
  });
});
