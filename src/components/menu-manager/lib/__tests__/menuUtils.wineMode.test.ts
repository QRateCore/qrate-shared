/**
 * Wine-menu builder sections.
 *
 * A menu with `menu_type === 'wine'` (set by the Add Menu wizard's wine
 * import flow) is organised under a SINGLE "Wine" top-level bucket, not the
 * 4 food courses and not the full drink-type list a `drinks_only` menu gets
 * — a wine list has no "Starters"/"Mains", and the full drink-type list
 * would surface Beer/Cocktails/etc. sections that are always empty for a
 * wine-only menu. Owner sub-categories (Reds, Reserve Reds, Bubbly, however
 * the source list is organised) nest underneath via the same raw_categories
 * mechanism every other bucket uses.
 *
 * The load-bearing property here is the negative one: a normal menu and a
 * drinks_only menu must behave exactly as they did before wine mode existed.
 */
import { describe, it, expect } from 'vitest';
import {
  MENU_SECTIONS,
  DRINK_TYPE_SECTIONS,
  WINE_MENU_SECTION,
  isWineMenu,
  isDrinksMenu,
  sectionsForMenu,
  buildAssignments,
  buildNestedAssignments,
  UNGROUPED_KEY,
} from '../menuUtils';
import type { MenuItemDisplay, MenuSummary } from '../../../../types/restaurant';

function menu(id: string, menu_type?: string | null, drinks_only = false): MenuSummary {
  return {
    id,
    name: id,
    slug: id,
    active: true,
    is_all_day: true,
    item_count: 0,
    schedule: null,
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    menu_type,
    drinks_only,
  } as MenuSummary;
}

function item(
  id: string,
  menuId: string,
  opts: { category?: string; rawCategories?: string[] } = {},
): MenuItemDisplay {
  return {
    id,
    name: id,
    price: 0,
    category: opts.category ?? 'Red Wines',
    menu_associations: [
      {
        menu_id: menuId,
        category_name: opts.category ?? 'Red Wines',
        canonical_categories: [],
        raw_categories: opts.rawCategories ?? [],
      },
    ],
  } as unknown as MenuItemDisplay;
}

describe('isWineMenu', () => {
  it('is false for a normal menu, a drinks_only menu, and missing/absent menus', () => {
    expect(isWineMenu(menu('m1'))).toBe(false);
    expect(isWineMenu(menu('m1', null, true))).toBe(false);
    expect(isWineMenu(menu('m1', 'full_service'))).toBe(false);
    expect(isWineMenu(menu('m1', 'beverage'))).toBe(false);
    expect(isWineMenu(null)).toBe(false);
    expect(isWineMenu(undefined)).toBe(false);
    expect(isWineMenu({} as MenuSummary)).toBe(false);
  });

  it('is true only for menu_type === "wine"', () => {
    expect(isWineMenu(menu('m1', 'wine'))).toBe(true);
  });
});

describe('sectionsForMenu — wine mode', () => {
  it('returns the single Wine bucket for a wine-type menu', () => {
    const sections = sectionsForMenu(menu('m1', 'wine'));
    expect(sections).toEqual([WINE_MENU_SECTION]);
    expect(sections.map((s) => s.label)).toEqual(['Wine']);
  });

  it('wine mode takes priority even if drinks_only is also set', () => {
    const sections = sectionsForMenu(menu('m1', 'wine', true));
    expect(sections).toEqual([WINE_MENU_SECTION]);
  });

  it('never applies a drinks-tree override to a wine-type menu', () => {
    const custom = [{ label: 'Natural Wine', canonical: 'nat_wine', members: ['nat_wine'] }];
    expect(sectionsForMenu(menu('m1', 'wine'), custom)).toEqual([WINE_MENU_SECTION]);
  });

  it('leaves a normal menu on the unchanged 4 courses', () => {
    expect(sectionsForMenu(menu('m1'))).toBe(MENU_SECTIONS);
  });

  it('leaves a drinks_only menu on the full drink-type list', () => {
    expect(sectionsForMenu(menu('m1', null, true))).toBe(DRINK_TYPE_SECTIONS);
  });
});

describe('buildAssignments — wine menus', () => {
  it('buckets every item under the single Wine key regardless of raw category', () => {
    const m = menu('wine-1', 'wine');
    const items = [
      item('i1', 'wine-1', { category: 'Red Wines' }),
      item('i2', 'wine-1', { category: 'Reserve Reds' }),
      item('i3', 'wine-1', { category: 'Bubbly' }),
    ];

    const result = buildAssignments(items, [m]);

    expect(result['wine-1'][WINE_MENU_SECTION.canonical]).toEqual(['i1', 'i2', 'i3']);
    // Canonical food/drink keys are not part of a wine menu's key space at all.
    expect(result['wine-1'].Beverages).toBeUndefined();
    expect(result['wine-1'].wine).toBeUndefined();
  });

  it('keys each menu independently when a wine menu and a normal menu are both present', () => {
    const food = menu('food-1', 'full_service');
    const wine = menu('wine-1', 'wine');
    const shared: MenuItemDisplay = {
      id: 'i1',
      name: 'Cross-listed Wine',
      price: 0,
      category: 'Beverages',
      menu_associations: [
        { menu_id: 'food-1', category_name: 'Beverages', canonical_categories: ['Beverages'] },
        { menu_id: 'wine-1', category_name: 'Red Wines', canonical_categories: [] },
      ],
    } as unknown as MenuItemDisplay;

    const result = buildAssignments([shared], [food, wine]);

    expect(result['food-1'].Beverages).toEqual(['i1']);
    expect(result['wine-1'][WINE_MENU_SECTION.canonical]).toEqual(['i1']);
  });

  it('leaves a drinks_only menu unaffected', () => {
    const m = menu('drinks-1', null, true);
    const result = buildAssignments(
      [{
        id: 'i1', name: 'i1', price: 0, category: 'Beverages', drink_subcategory_key: 'beer',
        menu_associations: [{ menu_id: 'drinks-1', category_name: 'Draft', canonical_categories: ['Beverages'] }],
      } as unknown as MenuItemDisplay],
      [m],
    );
    expect(result['drinks-1'].beer).toEqual(['i1']);
    expect(result['drinks-1'][WINE_MENU_SECTION.canonical]).toBeUndefined();
  });
});

describe('buildNestedAssignments — wine menus', () => {
  it('nests items by raw sub-category label under the single Wine bucket', () => {
    const m = [menu('wine-1', 'wine')];
    const items = [
      item('a', 'wine-1', { rawCategories: ['Reds'] }),
      item('b', 'wine-1', { rawCategories: ['Reds'] }),
      item('c', 'wine-1', { rawCategories: ['Reserve Reds'] }),
    ];
    const nested = buildNestedAssignments(items, m);
    expect(nested['wine-1'][WINE_MENU_SECTION.canonical]['Reds']).toEqual(['a', 'b']);
    expect(nested['wine-1'][WINE_MENU_SECTION.canonical]['Reserve Reds']).toEqual(['c']);
  });

  it('places a wine with no raw category under UNGROUPED_KEY, not dropped', () => {
    const nested = buildNestedAssignments(
      [item('a', 'wine-1', { rawCategories: [] })],
      [menu('wine-1', 'wine')],
    );
    expect(nested['wine-1'][WINE_MENU_SECTION.canonical][UNGROUPED_KEY]).toEqual(['a']);
  });

  it('does not seed or resolve canonical-category keys for a wine menu', () => {
    const nested = buildNestedAssignments(
      [item('a', 'wine-1', { category: 'Red Wines', rawCategories: ['Reds'] })],
      [menu('wine-1', 'wine')],
    );
    expect(nested['wine-1'].Beverages).toBeUndefined();
  });

  it('leaves a normal menu keyed by canonical category, unaffected by wine mode', () => {
    const nested = buildNestedAssignments(
      [item('a', 'food-1', { category: 'Entrees', rawCategories: ['Tacos'] })],
      [menu('food-1', 'full_service')],
    );
    expect(nested['food-1'].Entrees['Tacos']).toEqual(['a']);
    expect(nested['food-1'][WINE_MENU_SECTION.canonical]).toBeUndefined();
  });
});
