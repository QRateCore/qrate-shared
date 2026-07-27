// @vitest-environment jsdom
/**
 * MenuItemRow's collapsed-row price badge (`price-display-{id}`), 2026-07-27.
 *
 * Regression guard: the badge used to always render a flat `$X.XX` (from
 * settings.price / item.price / category_prices), with ZERO awareness of
 * wine items — even though the row's own EXPANDED section already branches
 * on `isWine` to show By Glass / By Bottle inputs instead of a flat price
 * (PDD 2026-06-15). A wine item with, say, glass=$5/bottle=$6 configured via
 * serving_price_overrides would show its unrelated base `item.price` (e.g.
 * $20.00) in the collapsed badge — misleading at a glance. Fixed: the badge
 * now reads serving_price_overrides for wine items and shows "Glass $X" /
 * "Bottle $Y" instead.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { MenuItemDisplay } from '../../../../types/restaurant';
import { _MenuItemRow as MenuItemRow } from '../MenuBuilder';

function makeItem(overrides: Partial<MenuItemDisplay> = {}): MenuItemDisplay {
  return {
    id: 'itm-1',
    name: 'Grilled Chicken',
    description: null,
    category: 'Entrees',
    item_type: 'dish',
    thumbnail_url: null,
    price: 12,
    active: true,
    menu_associations: [],
    food_tags: { allergens: [], dietary: [] },
    display_allergens: [],
    display_dietary: [],
    addons: [],
    sides: [],
    sides_and: [],
    sides_or: [],
    recommendations: [],
    gallery_urls: [],
    ...overrides,
  } as unknown as MenuItemDisplay;
}

const WINE_ITEM = makeItem({
  id: 'wine-1',
  name: 'J Lohr Seven Oaks Cabernet Sauvignon',
  price: 20,
  food_tags: { allergens: [], dietary: [], beverage: { beverage_type: 'wine' } },
});

function renderRow(props: Partial<React.ComponentProps<typeof MenuItemRow>> = {}) {
  render(
    <MenuItemRow
      item={makeItem()}
      menuId="menu-1"
      cat="Entrees"
      settings={{ price: null, boost_level: null, chefs_special: false, portion_type: 'single', portion_serves: null }}
      itemsById={new Map()}
      onUpdateSettings={vi.fn().mockResolvedValue(undefined)}
      onUpdateModifiers={vi.fn().mockResolvedValue(undefined)}
      onDragStart={vi.fn()}
      onDragEnd={vi.fn()}
      onRemove={vi.fn()}
      onEdit={vi.fn()}
      {...props}
    />,
  );
}

describe('MenuItemRow — collapsed-row price badge', () => {
  it('non-wine item shows a flat price (baseline, unchanged)', () => {
    renderRow({ settings: { price: 15, boost_level: null, chefs_special: false, portion_type: 'single', portion_serves: null } });
    expect(screen.getByTestId('price-display-itm-1')).toHaveTextContent('$15.00');
  });

  it('wine item with glass + bottle overrides shows BOTH, not the flat item price', () => {
    renderRow({
      item: WINE_ITEM,
      settings: {
        price: null, boost_level: null, chefs_special: false, portion_type: 'single', portion_serves: null,
        serving_price_overrides: { glass: 500, bottle: 600 },
      },
    });
    const badge = screen.getByTestId('price-display-wine-1');
    expect(badge).toHaveTextContent('Glass $5.00');
    expect(badge).toHaveTextContent('Bottle $6.00');
    expect(badge).not.toHaveTextContent('$20.00');
  });

  it('separates Glass/Bottle with non-breaking spaces, not plain ASCII spaces (regression: plain spaces collapse to one in rendered HTML)', () => {
    renderRow({
      item: WINE_ITEM,
      settings: {
        price: null, boost_level: null, chefs_special: false, portion_type: 'single', portion_serves: null,
        serving_price_overrides: { glass: 500, bottle: 600 },
      },
    });
    const badge = screen.getByTestId('price-display-wine-1');
    expect(badge.textContent).toContain('  ·  ');
  });

  it('wine item with only a glass override shows just Glass', () => {
    renderRow({
      item: WINE_ITEM,
      settings: {
        price: null, boost_level: null, chefs_special: false, portion_type: 'single', portion_serves: null,
        serving_price_overrides: { glass: 1100 },
      },
    });
    const badge = screen.getByTestId('price-display-wine-1');
    expect(badge).toHaveTextContent('Glass $11.00');
    expect(badge).not.toHaveTextContent('Bottle');
  });

  it('wine item with no serving_price_overrides at all shows no badge (never falls back to item.price)', () => {
    renderRow({
      item: WINE_ITEM,
      settings: { price: null, boost_level: null, chefs_special: false, portion_type: 'single', portion_serves: null },
    });
    expect(screen.queryByTestId('price-display-wine-1')).toBeNull();
  });
});
