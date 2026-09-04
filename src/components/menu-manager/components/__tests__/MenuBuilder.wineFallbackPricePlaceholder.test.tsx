// @vitest-environment jsdom
/**
 * MenuItemRow's expanded Glass/Bottle inline price inputs for a bottle-only
 * wine (no serving_options at all — a single flat item.price), 2026-09-04.
 *
 * Regression guard: with no per-menu serving_price_overrides, the Bottle
 * input's placeholder was a hardcoded "—", even though the item genuinely
 * has a price (menu_items.price) and the row's own COLLAPSED badge, right
 * next to this field, already shows that exact number (see
 * MenuBuilder.priceDisplay.test.tsx's 2026-09-04 fallback fix). Looked like
 * the price never made it onto the item. Fixed: the Bottle placeholder now
 * shows item.price, matching the collapsed badge and the same
 * "placeholder = item-level default" pattern already used for wines that
 * DO have serving_options.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { MenuItemDisplay } from '../../../../types/restaurant';
import { _MenuItemRow as MenuItemRow } from '../MenuBuilder';

function makeItem(overrides: Partial<MenuItemDisplay> = {}): MenuItemDisplay {
  return {
    id: 'wine-1',
    name: 'Faust, Cabernet Sauvignon, Napa, California 2022',
    description: null,
    category: 'Beverages',
    item_type: 'dish',
    thumbnail_url: null,
    price: 135,
    active: true,
    menu_associations: [],
    food_tags: { allergens: [], dietary: [], beverage: { beverage_type: 'wine' } },
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

function renderExpandedRow(props: Partial<React.ComponentProps<typeof MenuItemRow>> = {}) {
  render(
    <MenuItemRow
      item={makeItem()}
      menuId="menu-1"
      cat="Beverages"
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
  fireEvent.click(screen.getByTestId('menu-item-expand-wine-1'));
}

describe('MenuItemRow — bottle-only wine Glass/Bottle placeholder fallback', () => {
  it('shows the item price as the Bottle placeholder, not a bare dash', () => {
    renderExpandedRow();
    const bottleInput = screen.getByTestId('serving-price-input-wine-1-bottle') as HTMLInputElement;
    expect(bottleInput.placeholder).toBe('135');
    expect(bottleInput.value).toBe(''); // still an override field, not pre-filled
  });

  it('leaves the Glass placeholder as a dash — no item-level glass price exists for a bottle-only wine', () => {
    renderExpandedRow();
    const glassInput = screen.getByTestId('serving-price-input-wine-1-glass') as HTMLInputElement;
    expect(glassInput.placeholder).toBe('—');
  });

  it('an explicit per-menu override still shows in the input value, unaffected by the placeholder fallback', () => {
    renderExpandedRow({
      settings: {
        price: null, boost_level: null, chefs_special: false, portion_type: 'single', portion_serves: null,
        serving_price_overrides: { bottle: 14500 },
      },
    });
    const bottleInput = screen.getByTestId('serving-price-input-wine-1-bottle') as HTMLInputElement;
    expect(bottleInput.value).toBe('145');
  });

  it('a wine with real serving_options is unaffected (still uses its own per-serving placeholder)', () => {
    renderExpandedRow({
      item: makeItem({
        serving_options: [
          { id: 'glass', label: 'Glass', price_cents: 2200, is_default: true },
          { id: 'bottle', label: 'Bottle', price_cents: 7800, is_default: false },
        ],
      }),
    });
    expect(screen.queryByTestId('wine-prices-wine-1')).not.toBeInTheDocument();
    const bottleInput = screen.getByTestId('serving-price-input-wine-1-bottle') as HTMLInputElement;
    expect(bottleInput.placeholder).toBe('78');
  });
});
