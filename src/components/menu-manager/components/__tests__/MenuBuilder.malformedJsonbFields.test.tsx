// @vitest-environment jsdom
/**
 * Malformed JSONB array fields must not take the menu page down (2026-09-07).
 *
 * `serving_options`, `groupings` and `addons` are JSONB columns surfaced
 * straight from the API. A bad write can land a JSON *string* in the column
 * whose content is the real JSON — `?? []` does not catch it, because the
 * value is neither null nor undefined, and a string HAS `.length`, so a length
 * check passes and the code walks straight into `.map()`.
 *
 * That is exactly what happened: a dev→prod copy double-encoded every JSONB
 * value for three restaurants, `serving_options` read as the string "[]"
 * (length 2), and expanding any wine row on the owner menu page threw
 * `.map is not a function` — a whole-section crash. Collapsed rows looked
 * fine, so it only surfaced when an owner clicked.
 *
 * `asArray()` coerces at the read site: bad data degrades to "no options"
 * instead of blanking the surface. These tests pin the collapsed row, the
 * expanded row (where the crash fired), and the grouping chips.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { MenuItemDisplay } from '../../../../types/restaurant';
import { _MenuItemRow as MenuItemRow } from '../MenuBuilder';
import { getAddonsFromGroupings } from '../../../../lib/groupings/useGroupingAddons';
import { countApprovedAddons } from '../../lib/addonHelpers';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

const ITEM_ID = 'itm-wine-1';
const MENU_ID = 'menu-1';

/** A wine row whose JSONB array columns arrived double-encoded — each is the
 *  JSON *text* of the array, which is what Postgres returns for a jsonb value
 *  of type 'string'. Cast because the type says "array"; the whole point is
 *  that the runtime disagrees with the type. */
function makeMalformedItem(): MenuItemDisplay {
  return {
    id: ITEM_ID,
    name: 'Langhe Nebbiolo',
    description: null,
    category: 'Beverages',
    item_type: 'dish',
    thumbnail_url: null,
    price: 14,
    active: true,
    menu_associations: [],
    food_tags: { beverage: { beverage_type: 'wine' }, allergens: [], dietary: [] },
    display_allergens: [],
    display_dietary: [],
    addons: '[]',
    sides: [],
    sides_and: [],
    sides_or: [],
    recommendations: [],
    gallery_urls: '[]',
    groupings: '[]',
    serving_options: '[]',
  } as unknown as MenuItemDisplay;
}

const SETTINGS = {
  price: null,
  boost_level: null,
  chefs_special: false,
  portion_type: 'single' as const,
  portion_serves: null,
};

function renderRow(item: MenuItemDisplay) {
  render(
    <MenuItemRow
      item={item}
      menuId={MENU_ID}
      cat="Beverages"
      settings={SETTINGS}
      itemsById={new Map()}
      showIncludeZones={false}
      onUpdateSettings={vi.fn().mockResolvedValue(undefined)}
      onUpdateModifiers={vi.fn().mockResolvedValue(undefined)}
      onDragStart={vi.fn()}
      onDragEnd={vi.fn()}
      onRemove={vi.fn()}
      onEdit={vi.fn()}
    />,
  );
}

describe('MenuItemRow — double-encoded JSONB array fields', () => {
  it('renders the collapsed row', () => {
    renderRow(makeMalformedItem());
    expect(screen.getByTestId(`menu-item-row-${ITEM_ID}`)).toBeTruthy();
    expect(screen.getByText('Langhe Nebbiolo')).toBeTruthy();
  });

  it('expands a wine row without throwing — the crash the guard exists for', () => {
    renderRow(makeMalformedItem());
    fireEvent.click(screen.getByTestId(`menu-item-expand-${ITEM_ID}`));
    // The expanded settings block mounted at all …
    expect(screen.getByTestId(`menu-item-settings-${ITEM_ID}`)).toBeTruthy();
    // … and a string "[]" is treated as NO serving options, so the wine
    // Glass/Bottle fallback renders rather than the per-serving price row.
    expect(screen.getByTestId(`wine-prices-${ITEM_ID}`)).toBeTruthy();
    expect(screen.queryByTestId(`serving-prices-${ITEM_ID}`)).toBeNull();
    expect(screen.getByTestId(`serving-price-input-${ITEM_ID}-bottle`)).toBeTruthy();
  });

  it('renders no grouping chips for a malformed groupings value', () => {
    renderRow(makeMalformedItem());
    expect(document.querySelectorAll('[data-testid^="grouping-chip-"]')).toHaveLength(0);
  });

  it('still renders real serving options when the value IS an array', () => {
    const item = makeMalformedItem();
    (item as unknown as { serving_options: unknown }).serving_options = [
      { id: 'glass', label: 'Glass', price_cents: 1400 },
      { id: 'bottle', label: 'Bottle', price_cents: 5600 },
    ];
    renderRow(item);
    fireEvent.click(screen.getByTestId(`menu-item-expand-${ITEM_ID}`));
    expect(screen.getByTestId(`serving-prices-${ITEM_ID}`)).toBeTruthy();
    expect(screen.queryByTestId(`wine-prices-${ITEM_ID}`)).toBeNull();
  });
});

describe('grouping readers — double-encoded groupings', () => {
  /** The row-level tests above never reach getAddonsFromGroupings (the
   *  asArray() length check short-circuits first), so exercise it directly —
   *  it is a separate entry point, reached by every consumer that reads addons
   *  off an item without going through the row. */
  const malformed = { groupings: '[]' } as unknown as Parameters<typeof getAddonsFromGroupings>[0];

  it('getAddonsFromGroupings returns empty for a string groupings value', () => {
    expect(getAddonsFromGroupings(malformed)).toHaveLength(0);
  });

  it('getAddonsFromGroupings survives a string grouping.items value', () => {
    const item = { groupings: [{ id: 'g1', kind: 'addons', items: '[]' }] } as unknown as
      Parameters<typeof getAddonsFromGroupings>[0];
    expect(getAddonsFromGroupings(item)).toHaveLength(0);
  });

  it('countApprovedAddons returns 0 for a string groupings value', () => {
    expect(countApprovedAddons({ groupings: '[]', addons: '[]' } as unknown as
      Parameters<typeof countApprovedAddons>[0])).toBe(0);
  });

  it('getAddonsFromGroupings still reads a real addons grouping', () => {
    const item = {
      groupings: [{
        id: 'g1', kind: 'addons',
        items: [{ menu_item_id: 'a1', name: 'Extra cheese', status: 'approved' }],
      }],
    } as unknown as Parameters<typeof getAddonsFromGroupings>[0];
    expect(getAddonsFromGroupings(item)).toHaveLength(1);
  });
});
