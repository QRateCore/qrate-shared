import { describe, it, expect } from 'vitest';
import { isDrinkItem } from '../menuUtils';

describe('isDrinkItem', () => {
  it('true when the primary canonical is Beverages', () => {
    expect(isDrinkItem({ canonical_category: 'Beverages' })).toBe(true);
  });
  it('true when canonical_category is empty but canonical_categories[0] is Beverages', () => {
    expect(isDrinkItem({ canonical_category: null, canonical_categories: ['Beverages'] })).toBe(true);
  });
  it('false for food courses', () => {
    expect(isDrinkItem({ canonical_category: 'Entrees' })).toBe(false);
    expect(isDrinkItem({ canonical_categories: ['Appetizers', 'Sides'] })).toBe(false);
  });
  it('false when no canonical is set', () => {
    expect(isDrinkItem({})).toBe(false);
    expect(isDrinkItem({ canonical_category: null, canonical_categories: null })).toBe(false);
  });
  it('uses the PRIMARY canonical — a food item that also lists Beverages secondary is not a drink', () => {
    expect(isDrinkItem({ canonical_category: 'Entrees', canonical_categories: ['Entrees', 'Beverages'] })).toBe(false);
  });
});
