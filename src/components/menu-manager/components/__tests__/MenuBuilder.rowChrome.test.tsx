// @vitest-environment jsdom
/**
 * MenuItemRow `rowChrome` (owner Menu workspace, 2026-11-11): a consumer can
 * draw the collapsed desktop row itself. Pinned: the chrome replaces the
 * default row only when set; it gets the row's wired handlers — price commit
 * (single- and multi-course), boost, chef's special, portion, expand — and the
 * pairing chips; consumers that leave it unset keep the default row.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { MenuItemDisplay } from '../../../../types/restaurant';
import { _MenuItemRow as MenuItemRow, type MenuRowChromeProps } from '../MenuBuilder';

function makeItem(overrides: Partial<MenuItemDisplay> = {}): MenuItemDisplay {
  return {
    id: 'itm-1', name: 'Grilled Chicken', description: null, category: 'Entrees', item_type: 'dish',
    thumbnail_url: null, price: 12, active: true, menu_associations: [],
    food_tags: { allergens: [], dietary: [] }, display_allergens: [], display_dietary: [],
    addons: [], sides: [], sides_and: [], sides_or: [], recommendations: [], gallery_urls: [],
    ...overrides,
  } as unknown as MenuItemDisplay;
}

function renderWith(settings: Record<string, unknown>, cat = 'Entrees', withChrome = true) {
  const onUpdateSettings = vi.fn().mockResolvedValue(undefined);
  let last: MenuRowChromeProps | null = null;
  const rowChrome = (p: MenuRowChromeProps) => { last = p; return <div data-testid="chrome">{p.item.name}</div>; };
  render(
    <MenuItemRow
      item={makeItem()}
      menuId="menu-1"
      cat={cat}
      settings={settings}
      itemsById={new Map()}
      onUpdateSettings={onUpdateSettings}
      onUpdateModifiers={vi.fn().mockResolvedValue(undefined)}
      onDragStart={vi.fn()}
      onDragEnd={vi.fn()}
      onRemove={vi.fn()}
      onEdit={vi.fn()}
      onToggleActive={vi.fn()}
      rowChrome={withChrome ? rowChrome : undefined}
    />,
  );
  return { onUpdateSettings, props: () => last! };
}

describe('MenuItemRow rowChrome — pairing chips', () => {
  it('hands the real Active / Inactive pairing chips to the chrome (Bring into menu lives in the Inactive one)', () => {
    const target = makeItem({ id: 'tgt-1', name: 'Truffle Fries', menu_associations: [] });
    const dish = makeItem({
      menu_associations: [{ menu_id: 'menu-1', menu_name: 'Dinner', price: null }] as MenuItemDisplay['menu_associations'],
      groupings: [{
        id: 'g-1', kind: 'recommendations', name: 'Pairings', position: 0, is_default: true, is_deletable: false,
        is_symmetric: true, min_select: 0, max_select: null, default_select: 'none', pricing_contribution: 'none',
        items: [{ id: 'gi-1', menu_item_id: 'tgt-1', name: 'Truffle Fries', item_type: 'dish', position: 0, price_override: null, status: 'approved' }],
      }],
    } as unknown as Partial<MenuItemDisplay>);
    const menus = [{
      id: 'menu-1', name: 'Dinner', slug: 'dinner', display_order: 0, active: true, start_time: null, end_time: null,
      days_of_week: [0, 1, 2, 3, 4, 5, 6], is_all_day: true, schedule: null, item_count: 1,
    }];
    render(
      <MenuItemRow
        item={dish}
        menuId="menu-1"
        cat="Entrees"
        settings={{ price: null }}
        itemsById={new Map([[dish.id, dish], [target.id, target]])}
        menus={menus as never}
        onUpdateSettings={vi.fn().mockResolvedValue(undefined)}
        onUpdateModifiers={vi.fn().mockResolvedValue(undefined)}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
        onRemove={vi.fn()}
        onEdit={vi.fn()}
        rowChrome={(p) => <div data-testid="chrome" data-inactive={[...(p.inactivePairingIds ?? [])].join(',')} />}
      />,
    );
    // The target is on no menu, so it is an Inactive pairing for this dish.
    expect(screen.getByTestId('chrome')).toHaveAttribute('data-inactive', target.id);
  });
});

describe('MenuItemRow rowChrome', () => {
  it('replaces the default desktop row only when set', () => {
    renderWith({ price: null }, 'Entrees', false);
    expect(screen.queryByTestId('chrome')).toBeNull();
    expect(screen.getByTestId('menu-row-menu-itm-1')).toBeTruthy();
  });

  it('single course: price commit saves { price }', async () => {
    const { onUpdateSettings, props } = renderWith({ price: 14, boost_level: null, chefs_special: false, portion_type: 'single' });
    expect(screen.getByTestId('chrome').textContent).toBe('Grilled Chicken');
    expect(props().price.value).toBe('14');
    expect(props().price.editable).toBe(true);
    act(() => props().price.setValue('16.5'));
    await act(async () => { props().price.commit(); });
    expect(onUpdateSettings).toHaveBeenCalledWith('menu-1', 'itm-1', { price: 16.5 });
  });

  it('two courses: price commit patches only this course and keeps the other maps', async () => {
    const settings = {
      price: 10, canonical_categories: ['Appetizers', 'Entrees'],
      category_prices: { Appetizers: 8 }, category_boost_levels: {}, category_chefs_specials: {}, category_portions: {},
    };
    const { onUpdateSettings, props } = renderWith(settings, 'Entrees');
    expect(props().price.value).toBe('10');
    act(() => props().price.setValue('15'));
    await act(async () => { props().price.commit(); });
    expect(onUpdateSettings).toHaveBeenCalledWith('menu-1', 'itm-1', expect.objectContaining({
      category_prices: { Appetizers: 8, Entrees: 15 },
      category_boost_levels: {}, category_chefs_specials: {}, category_portions: {},
    }));
  });

  it('boost, chef’s special, portion and expand reach the row’s own handlers', async () => {
    const { onUpdateSettings, props } = renderWith({ price: null, boost_level: null, chefs_special: false, portion_type: 'single' });
    await act(async () => { props().onBoostChange('High'); });
    expect(onUpdateSettings).toHaveBeenLastCalledWith('menu-1', 'itm-1', { boost_level: '3' });
    await act(async () => { props().onToggleChefsSpecial(); });
    expect(onUpdateSettings).toHaveBeenLastCalledWith('menu-1', 'itm-1', { chefs_special: true });
    expect(props().expanded).toBe(false);
    act(() => props().toggleExpanded());
    expect(props().expanded).toBe(true);
    expect(screen.getByTestId('menu-item-settings-itm-1')).toBeTruthy();
  });
});
