// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { getSideItemIds, isItemUsedAsSideElsewhere } from '../menuUtils';
import type { MenuItemDisplay } from '../../../../types/restaurant';

const baseItem = (id: string, overrides: Partial<MenuItemDisplay> = {}): MenuItemDisplay =>
  ({
    id,
    name: id,
    item_type: 'dish',
    sides: [],
    sides_and: [],
    sides_or: [],
    addons: [],
    recommendations: [],
    ...overrides,
  }) as unknown as MenuItemDisplay;

describe('getSideItemIds', () => {
  it('returns empty set when item has no sides arrays', () => {
    expect(getSideItemIds(baseItem('a'))).toEqual(new Set());
  });

  it('collects ids from legacy single-zone sides', () => {
    const item = baseItem('parent', {
      sides: [{ menu_item_id: 'fries', name: 'Fries', price_override: null }],
    });
    expect(getSideItemIds(item)).toEqual(new Set(['fries']));
  });

  it('collects ids from split-mode sides_and + sides_or', () => {
    const item = baseItem('parent', {
      sides_and: [{ menu_item_id: 'a1', name: 'Bread', price_override: null }],
      sides_or: [{ menu_item_id: 'b1', name: 'Soup', price_override: null }],
    });
    expect(getSideItemIds(item)).toEqual(new Set(['a1', 'b1']));
  });

  it('unions across all three arrays without duplicates', () => {
    const item = baseItem('parent', {
      sides: [{ menu_item_id: 'shared', name: 'Shared', price_override: null }],
      sides_and: [{ menu_item_id: 'shared', name: 'Shared', price_override: null }],
      sides_or: [{ menu_item_id: 'unique', name: 'Unique', price_override: null }],
    });
    expect(getSideItemIds(item)).toEqual(new Set(['shared', 'unique']));
  });

  it('tolerates missing arrays (nullish-coalesce)', () => {
    const item = { id: 'p', name: 'p', item_type: 'dish' } as unknown as MenuItemDisplay;
    expect(getSideItemIds(item)).toEqual(new Set());
  });
});

describe('isItemUsedAsSideElsewhere', () => {
  it('returns false when target appears nowhere else', () => {
    const items = [
      baseItem('parent', { sides: [{ menu_item_id: 'fries', name: 'Fries', price_override: null }] }),
      baseItem('other'),
    ];
    expect(isItemUsedAsSideElsewhere(items, 'fries', 'parent')).toBe(false);
  });

  it('returns true when target appears on another item legacy sides', () => {
    const items = [
      baseItem('parent', {}),
      baseItem('other', { sides: [{ menu_item_id: 'fries', name: 'Fries', price_override: null }] }),
    ];
    expect(isItemUsedAsSideElsewhere(items, 'fries', 'parent')).toBe(true);
  });

  it('returns true when target appears on another item split mode', () => {
    const items = [
      baseItem('parent', {}),
      baseItem('other', { sides_and: [{ menu_item_id: 'rice', name: 'Rice', price_override: null }] }),
    ];
    expect(isItemUsedAsSideElsewhere(items, 'rice', 'parent')).toBe(true);
  });

  it('excludes the parent under inspection from the cross-check', () => {
    // The parent still lists `fries` in its sides — but we are excluding
    // it because we just removed `fries` and want to know if anyone else
    // is keeping it alive. Cross-check should ignore the parent.
    const items = [
      baseItem('parent', { sides: [{ menu_item_id: 'fries', name: 'Fries', price_override: null }] }),
      baseItem('other'),
    ];
    expect(isItemUsedAsSideElsewhere(items, 'fries', 'parent')).toBe(false);
  });
});
