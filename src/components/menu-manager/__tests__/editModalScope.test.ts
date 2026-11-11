/**
 * editModalScope — the Edit item modal's scope line, per-menu price review
 * hint and placement path. Pure; pinned because the sentences are what an
 * owner reads before saving a shared item.
 */

import { describe, it, expect } from 'vitest';
import { analyseMenuPricing, itemScopeLine, menuPricingHint, placementPath } from '../lib/editModalScope';

const p = (menu_id: string, menu_name: string, price: number | null) => ({ menu_id, menu_name, price });

describe('menuPricingHint', () => {
  it('names the widest gap and every unpriced menu, in the design sentence', () => {
    const hint = menuPricingHint([p('l', 'Lunch', 47), p('d', 'Dinner', 4), p('b', 'Bar', null)]);
    expect(hint).toBe('Lunch is $43.00 higher than Dinner, and Bar has no price. Review before saving.');
  });

  it('returns null when every menu is priced the same (nothing to flag)', () => {
    expect(menuPricingHint([p('l', 'Lunch', 12), p('d', 'Dinner', 12)])).toBeNull();
  });

  it('returns null for a single priced menu', () => {
    expect(menuPricingHint([p('l', 'Lunch', 12)])).toBeNull();
  });

  it('reports only the unpriced menus when prices agree', () => {
    expect(menuPricingHint([p('l', 'Lunch', 12), p('d', 'Dinner', 12), p('b', 'Bar', null), p('t', 'Tasting', null)]))
      .toBe('Bar and Tasting have no price. Review before saving.');
  });

  it('uses the caller\'s currency formatter', () => {
    expect(menuPricingHint([p('l', 'Lunch', 10), p('d', 'Dinner', 7.5)], (n) => `£${n.toFixed(2)}`))
      .toBe('Lunch is £2.50 higher than Dinner. Review before saving.');
  });

  it('dedupes one row per menu (the API repeats a menu per category)', () => {
    const facts = analyseMenuPricing([p('l', 'Lunch', 10), p('l', 'Lunch', 99), p('d', 'Dinner', 10)]);
    expect(facts.gap).toBeNull();
    expect(facts.unpriced).toEqual([]);
  });
});

describe('itemScopeLine', () => {
  it('pluralises the menu count', () => {
    expect(itemScopeLine(3)).toBe('Changes here update this item on all 3 menus it appears on.');
    expect(itemScopeLine(1)).toBe('Changes here update this item on the 1 menu it appears on.');
    expect(itemScopeLine(0)).toBe('Not on any menu yet — add it from Menu pricing once saved.');
  });
});

describe('placementPath', () => {
  it('reads "<Menu> / <Course> / <Sub-category>"', () => {
    expect(placementPath({ menu_name: 'Lunch', category_name: 'Drinks', raw_categories: ['Beer (Bottle)'] }))
      .toBe('Lunch / Drinks / Beer (Bottle)');
  });

  it('drops the parts a placement does not carry', () => {
    expect(placementPath({ menu_name: 'Bar' })).toBe('Bar');
    expect(placementPath({ menu_name: 'Bar', category_name: null, raw_categories: ['', '  '] })).toBe('Bar');
    expect(placementPath({ menu_name: 'Bar', raw_categories: ['Bottles', 'Imports'] })).toBe('Bar / Bottles · Imports');
  });
});
