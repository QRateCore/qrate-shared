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
 *
 * 2026-09-04: that fix over-corrected — with no per-menu override, the badge
 * showed NOTHING at all, even for a freshly imported/committed wine whose
 * own menu_items.price / serving_options already carry a correct price. Now
 * falls back to the item's own price per serving when there's no override,
 * matching the "falls back to the item-level price" contract the expanded
 * editor's handleServingPriceBlur already documents.
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

  it('wine item with only a glass override shows Glass from the override and Bottle from the item fallback', () => {
    // WINE_ITEM has no serving_options, so its flat price ($20) is the
    // item's own bottle price (2026-09-04 fallback) — a glass-only override
    // adds a glass option alongside it, it doesn't replace the bottle.
    renderRow({
      item: WINE_ITEM,
      settings: {
        price: null, boost_level: null, chefs_special: false, portion_type: 'single', portion_serves: null,
        serving_price_overrides: { glass: 1100 },
      },
    });
    const badge = screen.getByTestId('price-display-wine-1');
    expect(badge).toHaveTextContent('Glass $11.00');
    expect(badge).toHaveTextContent('Bottle $20.00');
  });

  // 2026-09-04: a freshly imported/committed wine has NO per-menu override
  // yet — that's the normal state, not an edge case — but its own
  // menu_items.price / serving_options are already correct from import.
  // The badge used to show nothing at all until the owner set a redundant
  // per-menu override; it now falls back to the item's own price, mirroring
  // the "falls back to the item-level price" contract the expanded editor's
  // handleServingPriceBlur already documents.
  it('bottle-only wine (no serving_options) with no override falls back to the flat item price as Bottle', () => {
    renderRow({
      item: WINE_ITEM, // price: 20, no serving_options — single-priced, bottle-only
      settings: { price: null, boost_level: null, chefs_special: false, portion_type: 'single', portion_serves: null },
    });
    const badge = screen.getByTestId('price-display-wine-1');
    expect(badge).toHaveTextContent('Bottle $20.00');
    expect(badge).not.toHaveTextContent('Glass');
  });

  it('wine with glass+bottle serving_options and no override falls back to both from the item', () => {
    renderRow({
      item: makeItem({
        id: 'wine-2',
        price: 22,
        food_tags: { allergens: [], dietary: [], beverage: { beverage_type: 'wine' } },
        serving_options: [
          { id: 'glass', label: 'Glass', price_cents: 2200, is_default: true },
          { id: 'bottle', label: 'Bottle', price_cents: 7800, is_default: false },
        ],
      }),
      settings: { price: null, boost_level: null, chefs_special: false, portion_type: 'single', portion_serves: null },
    });
    const badge = screen.getByTestId('price-display-wine-2');
    expect(badge).toHaveTextContent('Glass $22.00');
    expect(badge).toHaveTextContent('Bottle $78.00');
  });

  it('an explicit per-menu override still wins over the item-level fallback for that serving', () => {
    renderRow({
      item: makeItem({
        id: 'wine-3',
        price: 22,
        food_tags: { allergens: [], dietary: [], beverage: { beverage_type: 'wine' } },
        serving_options: [
          { id: 'glass', label: 'Glass', price_cents: 2200, is_default: true },
          { id: 'bottle', label: 'Bottle', price_cents: 7800, is_default: false },
        ],
      }),
      settings: {
        price: null, boost_level: null, chefs_special: false, portion_type: 'single', portion_serves: null,
        serving_price_overrides: { bottle: 8500 }, // this menu charges more for the bottle
      },
    });
    const badge = screen.getByTestId('price-display-wine-3');
    expect(badge).toHaveTextContent('Glass $22.00'); // unoverridden — falls back to the item
    expect(badge).toHaveTextContent('Bottle $85.00'); // overridden — wins over the item's $78
  });
});
