/**
 * Drinks-mode builder sections.
 *
 * A menu flagged `drinks_only` is organised by DRINK TYPE (Beer / Wine /
 * Cocktails …) instead of the 4 food courses, and its item placements are keyed
 * by `drink_subcategory_key` rather than canonical category.
 *
 * The load-bearing property here is the negative one: a normal menu must behave
 * exactly as it did before drinks mode existed.
 */
import { describe, it, expect } from 'vitest';
import {
  MENU_SECTIONS,
  DRINK_TYPE_SECTIONS,
  DRINK_UNCLASSIFIED_KEY,
  isDrinksMenu,
  sectionsForMenu,
  buildAssignments,
} from '../menuUtils';
import type { MenuItemDisplay, MenuSummary } from '../../../../types/restaurant';

function menu(id: string, drinks_only = false): MenuSummary {
  return {
    id,
    name: id,
    slug: id,
    active: true,
    is_all_day: true,
    item_count: 0,
    schedule: null,
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    drinks_only,
  } as MenuSummary;
}

function item(
  id: string,
  menuId: string,
  opts: { canonicals?: string[]; drinkKey?: string | null; category?: string } = {},
): MenuItemDisplay {
  return {
    id,
    name: id,
    price: 0,
    category: opts.category ?? 'Beverages',
    drink_subcategory_key: opts.drinkKey ?? null,
    menu_associations: [
      {
        menu_id: menuId,
        category_name: opts.category ?? 'Beverages',
        canonical_categories: opts.canonicals ?? ['Beverages'],
      },
    ],
  } as unknown as MenuItemDisplay;
}

describe('isDrinksMenu', () => {
  it('is false for a normal menu and for missing/absent flags', () => {
    expect(isDrinksMenu(menu('m1'))).toBe(false);
    expect(isDrinksMenu(null)).toBe(false);
    expect(isDrinksMenu(undefined)).toBe(false);
    expect(isDrinksMenu({} as MenuSummary)).toBe(false);
  });

  it('is true once the menu is flagged', () => {
    expect(isDrinksMenu(menu('m1', true))).toBe(true);
  });
});

describe('sectionsForMenu', () => {
  it('returns the unchanged food courses for a normal menu', () => {
    expect(sectionsForMenu(menu('m1'))).toBe(MENU_SECTIONS);
    expect(sectionsForMenu(menu('m1')).map((s) => s.label)).toEqual([
      'Drinks',
      'Starters',
      'Mains',
      'Desserts',
    ]);
  });

  it('returns drink types for a drinks menu', () => {
    const sections = sectionsForMenu(menu('m1', true));
    expect(sections.map((s) => s.canonical).slice(0, 4)).toEqual([
      'beer',
      'wine',
      'cocktails',
      'spirits',
    ]);
    expect(sections.map((s) => s.label)).toContain('Soft Drinks');
  });

  it('keeps the unclassified bucket last', () => {
    const sections = sectionsForMenu(menu('m1', true));
    expect(sections[sections.length - 1].canonical).toBe(DRINK_UNCLASSIFIED_KEY);
  });

  it('prefers the restaurant’s own tree when supplied', () => {
    const custom = [{ label: 'Natural Wine', canonical: 'nat_wine', members: ['nat_wine'] }];
    expect(sectionsForMenu(menu('m1', true), custom)).toBe(custom);
  });

  it('ignores an empty override rather than rendering no zones', () => {
    expect(sectionsForMenu(menu('m1', true), [])).toBe(DRINK_TYPE_SECTIONS);
  });

  it('never applies an override to a food menu', () => {
    const custom = [{ label: 'Natural Wine', canonical: 'nat_wine', members: ['nat_wine'] }];
    expect(sectionsForMenu(menu('m1', false), custom)).toBe(MENU_SECTIONS);
  });
});

describe('buildAssignments — drinks menus', () => {
  it('buckets items by drink type, not canonical category', () => {
    const m = menu('drinks-1', true);
    const items = [
      item('i1', 'drinks-1', { drinkKey: 'beer' }),
      item('i2', 'drinks-1', { drinkKey: 'wine' }),
      item('i3', 'drinks-1', { drinkKey: 'beer' }),
    ];

    const result = buildAssignments(items, [m]);

    expect(result['drinks-1'].beer).toEqual(['i1', 'i3']);
    expect(result['drinks-1'].wine).toEqual(['i2']);
    // Canonical keys are not part of a drinks menu's key space at all.
    expect(result['drinks-1'].Beverages).toBeUndefined();
  });

  it('puts items with no drink type into the reserved bucket', () => {
    const m = menu('drinks-1', true);
    const result = buildAssignments([item('i1', 'drinks-1', { drinkKey: null })], [m]);

    expect(result['drinks-1'][DRINK_UNCLASSIFIED_KEY]).toEqual(['i1']);
  });

  it('leaves normal menus keyed by canonical category', () => {
    const m = menu('food-1', false);
    const result = buildAssignments(
      [item('i1', 'food-1', { canonicals: ['Appetizers'], category: 'Starters' })],
      [m],
    );

    expect(result['food-1'].Appetizers).toEqual(['i1']);
    expect(result['food-1'].beer).toBeUndefined();
  });

  it('keys each menu independently when both kinds are present', () => {
    const food = menu('food-1', false);
    const drinks = menu('drinks-1', true);
    const shared: MenuItemDisplay = {
      id: 'i1',
      name: 'House Lager',
      price: 0,
      category: 'Beverages',
      drink_subcategory_key: 'beer',
      menu_associations: [
        { menu_id: 'food-1', category_name: 'Beverages', canonical_categories: ['Beverages'] },
        { menu_id: 'drinks-1', category_name: 'Draft', canonical_categories: ['Beverages'] },
      ],
    } as unknown as MenuItemDisplay;

    const result = buildAssignments([shared], [food, drinks]);

    expect(result['food-1'].Beverages).toEqual(['i1']);
    expect(result['drinks-1'].beer).toEqual(['i1']);
  });
});
